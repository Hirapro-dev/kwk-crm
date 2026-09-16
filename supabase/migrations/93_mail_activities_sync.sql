-- ============================================================================
-- migration 93: 会員に紐付けたメールを対応歴(activities)に自動記録する (2026-09-16)
--               CLAUDE.md §5.7 / §5.15 M3
--
-- 目的:
--   メーラーでスレッドを会員に紐付けたら、そのメール(受信・送信の各1通)が会員詳細の対応歴に
--   件名付きで並び、クリックでメーラーのスレッドを開けるようにする。
--
-- 方針:
--   - 対応歴は既存の activities に実レコードとして持つ(会員詳細・対応歴一覧・レポートで同じに見える)。
--     activities に mail_message_id(1通1行の冪等キー)と mail_thread_id(メーラーへのリンク先)を足す。
--   - 記録は DB トリガーで行う(アプリ側の紐付け経路が複数あるため: 手動紐付け・一括更新・受信時の
--     会員突合・取込ルールの自動照合。どこから紐付けても同じ結果になる)。
--       * mail_messages に行が入ったとき(スレッドが会員に紐付いていれば記録)
--       * mail_threads.member_id が変わったとき(紐付け → 記録 / 付け替え → 会員を更新 / 解除 → 論理削除)
--   - 値の決め方(決定論的):
--       d_bunrui = 'LINE／メール' (既存の接触種別) / m_bunrui = NULL / s_bunrui = '受信' or '送信'
--       description = メールの件名(無ければスレッドの件名、無ければ '(件名なし)')
--       registered_datetime = 送受信日時、registered_date = その日本時間の日付
--       owner_id = 送信ならその送信者、受信ならスレッドの担当(未割当なら NULL)。created_by_id = 送信者(受信は NULL)
--   - 関数は SECURITY DEFINER(activities の RLS/権限に依らず記録できるように)。監査ログのトリガーは
--     そのまま動く(人の操作の中で記録されたものは実行者付きで残る)。
--   - 過去分(既に紐付いている約 3.7 万スレッド)は自動では入れない。必要なら末尾の「過去分の取り込み」を実行する。
-- ============================================================================

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS mail_message_id uuid REFERENCES public.mail_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mail_thread_id  uuid REFERENCES public.mail_threads(id)  ON DELETE SET NULL;

COMMENT ON COLUMN public.activities.mail_message_id IS 'メーラーのメール(1通1行の冪等キー)。CLAUDE.md §5.7';
COMMENT ON COLUMN public.activities.mail_thread_id  IS 'メーラーのスレッド(対応歴からメーラーを開くリンク先)。CLAUDE.md §5.7';

CREATE UNIQUE INDEX IF NOT EXISTS uq_activities_mail_message
  ON public.activities(mail_message_id) WHERE mail_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activities_mail_thread
  ON public.activities(mail_thread_id) WHERE mail_thread_id IS NOT NULL;

-- スレッド1件分を対応歴に反映する(紐付け・付け替え・解除・新着のすべてで同じ関数を使う)
CREATE OR REPLACE FUNCTION public.sync_mail_thread_activities(p_thread_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member text;
  v_deleted timestamptz;
BEGIN
  SELECT member_id, deleted_at INTO v_member, v_deleted
  FROM public.mail_threads WHERE id = p_thread_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- 紐付け解除(またはスレッド削除): このスレッド由来の対応歴を論理削除
  IF v_member IS NULL OR v_deleted IS NOT NULL THEN
    UPDATE public.activities
       SET deleted_at = now()
     WHERE mail_thread_id = p_thread_id AND deleted_at IS NULL;
    RETURN;
  END IF;

  -- 付け替え・再紐付け: 既存行の会員を合わせ、解除時に消した行を戻す
  UPDATE public.activities
     SET member_id = v_member, deleted_at = NULL
   WHERE mail_thread_id = p_thread_id
     AND (member_id IS DISTINCT FROM v_member OR deleted_at IS NOT NULL);

  -- 未記録のメールを追加(1通1行。mail_message_id で冪等)
  INSERT INTO public.activities (
    owner_id, member_id, created_by_id, description,
    d_bunrui, m_bunrui, s_bunrui,
    registered_date, registered_datetime,
    mail_message_id, mail_thread_id
  )
  SELECT
    COALESCE(m.sender_user_id, t.assignee_id),
    t.member_id,
    m.sender_user_id,
    COALESCE(NULLIF(m.subject, ''), NULLIF(t.subject, ''), '(件名なし)'),
    'LINE／メール', NULL,
    CASE WHEN m.direction = 'out' THEN '送信' ELSE '受信' END,
    (COALESCE(m.sent_at, m.created_at) AT TIME ZONE 'Asia/Tokyo')::date,
    COALESCE(m.sent_at, m.created_at),
    m.id, t.id
  FROM public.mail_messages m
  JOIN public.mail_threads t ON t.id = m.thread_id
  WHERE t.id = p_thread_id
    AND NOT EXISTS (SELECT 1 FROM public.activities a WHERE a.mail_message_id = m.id);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_mail_thread_activities(uuid) FROM PUBLIC;

-- トリガー: メールが入ったとき
CREATE OR REPLACE FUNCTION public.trg_mail_message_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.mail_threads WHERE id = NEW.thread_id AND member_id IS NOT NULL AND deleted_at IS NULL) THEN
    PERFORM public.sync_mail_thread_activities(NEW.thread_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mail_messages_activity ON public.mail_messages;
CREATE TRIGGER mail_messages_activity
  AFTER INSERT ON public.mail_messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_mail_message_activity();

-- トリガー: スレッドの会員紐付けが変わったとき(削除・復元も)
CREATE OR REPLACE FUNCTION public.trg_mail_thread_member_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.member_id IS DISTINCT FROM NEW.member_id OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
    PERFORM public.sync_mail_thread_activities(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mail_threads_member_activity ON public.mail_threads;
CREATE TRIGGER mail_threads_member_activity
  AFTER UPDATE OF member_id, deleted_at ON public.mail_threads
  FOR EACH ROW EXECUTE FUNCTION public.trg_mail_thread_member_activity();

-- ----------------------------------------------------------------------------
-- 過去分の取り込み(任意。実行前に件数を確認すること)
--   紐付け済みスレッド(約 3.7 万件)のメールを対応歴にまとめて記録する。
--   受信メール全件が対応歴に並ぶため、対応歴の件数が大きく増える。運用判断のうえで実行する。
--   件数の確認:
--     SELECT count(*) FROM public.mail_messages m
--       JOIN public.mail_threads t ON t.id = m.thread_id
--      WHERE t.member_id IS NOT NULL AND t.deleted_at IS NULL
--        AND NOT EXISTS (SELECT 1 FROM public.activities a WHERE a.mail_message_id = m.id);
--   実行:
--     SELECT public.sync_mail_thread_activities(id)
--       FROM public.mail_threads WHERE member_id IS NOT NULL AND deleted_at IS NULL;
-- ----------------------------------------------------------------------------
