-- ============================================================================
-- migration 136: メーラーの件数表 (2026-10-29)
--                CLAUDE.md §5.15「件数表(タブ・左フォルダの件数)」
--
-- それまではタブ 7 つと左フォルダの件数を、表示のたびに mail_threads(約 117 万件)から数え直していた
-- (1 画面で 8〜14 本を同時に数えて 1〜2 秒。何人もが開くとデータベース全体が重くなる)。
-- 受信箱 × 分類 × 状態 × 既読 × 取込候補 ごとの件数を別の表に持ち、mail_threads の変更のたびに
-- トリガーで足し引きする。画面は件数表から合計するだけにする(ユーザー決定: タブの件数はすべて残す)。
--
-- 1. mail_thread_counts(件数表)と RLS
-- 2. トリガー(文単位。1 回の操作で何行変えても件数表の更新は 1 回)
-- 3. rebuild_mail_thread_counts(): 実際の件数で数え直す(サービスロールのみ。ロックを取らず、差だけを足す)
-- 4. mail_thread_count_groups(): 受信箱で絞った合計(画面用)
-- 5. mail_box_counts(): 件数表から読むように作り直す(戻り値は migration 77 と同じ)
--
-- 適用(2 回に分ける。トリガーの作成で mail_threads の書込みを止める時間を短くするため):
--   (1) SQL Editor でこのファイルをまとめて実行する(すぐ終わる)
--   (2) 続けて SELECT public.rebuild_mail_thread_counts(); を実行して件数表の中身を作る(数秒。書込みは止めない)
--   (1) と (2) の間に変わったスレッドの分は (2) で正しくなる。画面は件数表が空のあいだ従来の数え方で数える。
-- 戻すとき: トリガー 3 つを DROP し、mail_box_counts() を migration 77 の定義に戻す(画面は件数表が読めなければ従来の数え方に戻る)。
-- 注意: トリガーを通らない書き換え(TRUNCATE、トリガーを止めた作業など)をしたら、その後に (2) を実行する。
--       mail_threads の区分(状態・分類・既読・受信箱など)を、1 つの長いトランザクションで何度も一括変更しない
--       (件数表の行の書込みロックをトランザクションの終わりまで持ち、ほかの更新を待たせるため。文ごとにコミットする)。
-- ============================================================================

-- 先に長い処理がいると、トリガーの作成がその終わりを待って後ろの処理を詰まらせるため、待つのは 5 秒まで
SET lock_timeout = '5s';

-- 1. 件数表 ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_thread_counts (
  mail_box_id         integer     NOT NULL,
  category            text        NOT NULL,
  status              text        NOT NULL,
  is_read             boolean     NOT NULL,
  is_import_candidate boolean     NOT NULL,
  n                   bigint      NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mail_box_id, category, status, is_read, is_import_candidate)
) WITH (fillfactor = 70);  -- 同じ行を何度も書き換える小さな表のため、空きを残して HOT 更新を効かせる

COMMENT ON TABLE public.mail_thread_counts IS
  'メーラーのタブ・左フォルダの件数(削除済みを除くスレッド数)。mail_threads のトリガーで更新する。CLAUDE.md §5.15';

ALTER TABLE public.mail_thread_counts ENABLE ROW LEVEL SECURITY;

-- 既定で付く権限(書込み・TRUNCATE など)を外し、読むだけにする。書込みはトリガー関数(所有者の権限)だけ
REVOKE ALL ON public.mail_thread_counts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mail_thread_counts TO authenticated;
GRANT ALL ON public.mail_thread_counts TO service_role;

-- メールは全ロールが閲覧できる(mail_threads_select)ので、件数も全ロールが読める。書込みのポリシーは設けない
DROP POLICY IF EXISTS mail_thread_counts_select ON public.mail_thread_counts;
CREATE POLICY mail_thread_counts_select ON public.mail_thread_counts
  FOR SELECT TO authenticated USING (true);

-- 2. トリガー ------------------------------------------------------------
-- 移行表(REFERENCING)は 1 つのトリガーに 1 つのイベントしか付けられないため、INSERT / UPDATE / DELETE で 3 つ作る。
-- 同じ区分の行は 1 回の INSERT ... ON CONFLICT にまとめ、キーの順に書く(同時に動く更新どうしの行き違いを防ぐ)。
CREATE OR REPLACE FUNCTION public.trg_mail_thread_counts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.mail_thread_counts AS c
      (mail_box_id, category, status, is_read, is_import_candidate, n)
    SELECT mail_box_id, category, status, is_read, is_import_candidate, count(*)
      FROM new_rows
     WHERE deleted_at IS NULL
     GROUP BY 1, 2, 3, 4, 5
     ORDER BY 1, 2, 3, 4, 5
    ON CONFLICT (mail_box_id, category, status, is_read, is_import_candidate)
      DO UPDATE SET n = c.n + EXCLUDED.n, updated_at = now();
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.mail_thread_counts AS c
      (mail_box_id, category, status, is_read, is_import_candidate, n)
    SELECT mail_box_id, category, status, is_read, is_import_candidate, -count(*)
      FROM old_rows
     WHERE deleted_at IS NULL
     GROUP BY 1, 2, 3, 4, 5
     ORDER BY 1, 2, 3, 4, 5
    ON CONFLICT (mail_box_id, category, status, is_read, is_import_candidate)
      DO UPDATE SET n = c.n + EXCLUDED.n, updated_at = now();
  ELSE
    -- UPDATE: 変更前を引いて変更後を足す。区分が変わらない更新(最終受信日時・件名など)は差が 0 で何も書かない
    INSERT INTO public.mail_thread_counts AS c
      (mail_box_id, category, status, is_read, is_import_candidate, n)
    SELECT mail_box_id, category, status, is_read, is_import_candidate, sum(delta)
      FROM (
        SELECT mail_box_id, category, status, is_read, is_import_candidate, 1 AS delta
          FROM new_rows WHERE deleted_at IS NULL
        UNION ALL
        SELECT mail_box_id, category, status, is_read, is_import_candidate, -1 AS delta
          FROM old_rows WHERE deleted_at IS NULL
      ) d
     GROUP BY 1, 2, 3, 4, 5
    HAVING sum(delta) <> 0
     ORDER BY 1, 2, 3, 4, 5
    ON CONFLICT (mail_box_id, category, status, is_read, is_import_candidate)
      DO UPDATE SET n = c.n + EXCLUDED.n, updated_at = now();
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_mail_thread_counts() FROM PUBLIC, anon, authenticated;

-- CREATE OR REPLACE TRIGGER は DROP TRIGGER と違い、作成中も mail_threads の読み出しを止めない
CREATE OR REPLACE TRIGGER mail_thread_counts_ins
  AFTER INSERT ON public.mail_threads
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_mail_thread_counts();

CREATE OR REPLACE TRIGGER mail_thread_counts_upd
  AFTER UPDATE ON public.mail_threads
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_mail_thread_counts();

CREATE OR REPLACE TRIGGER mail_thread_counts_del
  AFTER DELETE ON public.mail_threads
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_mail_thread_counts();

-- 3. 数え直し ------------------------------------------------------------
-- ロックは取らない。件数表はスレッドの変更と同じトランザクションで書かれるので、1 つの文(= 1 つのスナップショット)の中では
-- 「実際の件数」と「件数表」は、ずれが無ければ必ず一致する。その差(ずれ)だけを件数表に足すので、数えている間に
-- 同時に起きた更新(トリガーの足し引き)とぶつからず、取りこぼしも二重計上もしない。違っていた区分の数を返す(0 = 一致)。
-- 全体を 1 文で書くこと(文を分けるとスナップショットが変わり、この前提が崩れる)。
CREATE OR REPLACE FUNCTION public.rebuild_mail_thread_counts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_changed integer;
BEGIN
  WITH fresh AS (
    SELECT mail_box_id, category, status, is_read, is_import_candidate, count(*)::bigint AS n
      FROM public.mail_threads
     WHERE deleted_at IS NULL
     GROUP BY 1, 2, 3, 4, 5
  ),
  diff AS (
    SELECT mail_box_id, category, status, is_read, is_import_candidate,
           coalesce(f.n, 0) - coalesce(c.n, 0) AS d
      FROM fresh f
      FULL JOIN public.mail_thread_counts c
      USING (mail_box_id, category, status, is_read, is_import_candidate)
     WHERE coalesce(f.n, 0) <> coalesce(c.n, 0)
  ),
  up AS (
    INSERT INTO public.mail_thread_counts AS c
      (mail_box_id, category, status, is_read, is_import_candidate, n)
    SELECT mail_box_id, category, status, is_read, is_import_candidate, d
      FROM diff
     ORDER BY 1, 2, 3, 4, 5
    ON CONFLICT (mail_box_id, category, status, is_read, is_import_candidate)
      DO UPDATE SET n = c.n + EXCLUDED.n, updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_changed FROM up;
  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.rebuild_mail_thread_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_mail_thread_counts() TO service_role;

-- 4. 画面用の合計 --------------------------------------------------------
-- p_box_ids: NULL = 全受信箱 / 配列 = その受信箱だけ(空配列なら 0 件)。分類・状態・既読・取込候補ごとに返す(最大 64 行)
CREATE OR REPLACE FUNCTION public.mail_thread_count_groups(p_box_ids integer[] DEFAULT NULL)
RETURNS TABLE (
  category            text,
  status              text,
  is_read             boolean,
  is_import_candidate boolean,
  n                   bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT c.category, c.status, c.is_read, c.is_import_candidate, sum(c.n)::bigint
    FROM public.mail_thread_counts c
   WHERE p_box_ids IS NULL OR c.mail_box_id = ANY (p_box_ids)
   GROUP BY 1, 2, 3, 4;
$$;

COMMENT ON FUNCTION public.mail_thread_count_groups(integer[]) IS
  'メーラーのタブ・取込候補の件数用: 受信箱で絞った分類・状態・既読・取込候補ごとのスレッド数(件数表から)';

REVOKE ALL ON FUNCTION public.mail_thread_count_groups(integer[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mail_thread_count_groups(integer[]) TO authenticated;

-- 5. 左フォルダの件数(migration 77 と同じ戻り値) ----------------------------
CREATE OR REPLACE FUNCTION public.mail_box_counts()
RETURNS TABLE (
  mail_box_id integer,
  pending_count bigint,
  unread_count bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    c.mail_box_id,
    coalesce(sum(c.n) FILTER (WHERE c.status = '未対応'), 0)::bigint AS pending_count,
    coalesce(sum(c.n) FILTER (WHERE c.is_read = false), 0)::bigint   AS unread_count
  FROM public.mail_thread_counts c
  WHERE c.category = '通常'
  GROUP BY c.mail_box_id
  HAVING sum(c.n) > 0;
$$;

COMMENT ON FUNCTION public.mail_box_counts() IS
  'メーラーのフォルダ一覧用: 受信箱ごとの未対応件数・未読件数(通常分類のみ。2026-10-29 から件数表 mail_thread_counts から読む)';

-- 6. 中身を作るのは別に実行する(冒頭の「適用」の (2))。
--    SELECT public.rebuild_mail_thread_counts();
