-- ============================================================================
-- migration 80: 過去データ取込(scripts/mail/import_maildealer.ts)用の一括照会 RPC
-- (2026-09)
--
-- 背景:
--   取込スクリプトは、対象ファイルの message_id(数千〜数万件)がどれだけ
--   既に取り込み済みかを事前照会する。PostgREST の `.in()` フィルタは値を
--   GET リクエストの URL に埋め込むため、500件はおろか 300件程度でも
--   URL/ヘッダー長の上限(通常16KB)を超えて失敗する
--   (実測: 実データで 200件は成功、300件で "HeadersOverflowError"、
--   500件で 400 Bad Request)。Supabase 公式のエラーメッセージも
--   「200件を超える配列フィルタは RPC 関数を使うこと」と案内している。
--
-- 対応:
--   配列を POST の JSON body で渡す RPC 関数に置き換え、URL 長の制約を回避する。
--   - lookup_mail_message_thread_ids(): message_id の配列から、既に存在する
--     (message_id, thread_id) の組を返す(自分自身の重複判定 + 参照先スレッドの解決)
--   - lookup_mail_thread_states(): thread_id の配列から、現在の状態
--     (受信箱・状態・分類・会員・担当・最終メール日時・方向)を返す
--     (巻き戻し防止の基準値を取るため)
--
--   どちらも SECURITY INVOKER(既定)。対象テーブルの RLS(migration 76: 全ロール
--   SELECT 可)がそのまま効くため、権限を広げるものではない。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lookup_mail_message_thread_ids(p_message_ids text[])
RETURNS TABLE (message_id text, thread_id uuid)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT m.message_id, m.thread_id
  FROM public.mail_messages m
  WHERE m.message_id = ANY(p_message_ids);
$$;

COMMENT ON FUNCTION public.lookup_mail_message_thread_ids(text[]) IS
  '過去データ取込用: message_id の配列から既存の (message_id, thread_id) を返す。
   URL 長の制約を避けるため .in() の代わりに使う。CLAUDE.md §5.15';

GRANT EXECUTE ON FUNCTION public.lookup_mail_message_thread_ids(text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.lookup_mail_thread_states(p_thread_ids uuid[])
RETURNS TABLE (
  id uuid,
  mail_box_id integer,
  status text,
  category text,
  member_id text,
  assignee_id uuid,
  last_message_at timestamptz,
  last_direction text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT t.id, t.mail_box_id, t.status, t.category, t.member_id, t.assignee_id,
         t.last_message_at, t.last_direction
  FROM public.mail_threads t
  WHERE t.id = ANY(p_thread_ids);
$$;

COMMENT ON FUNCTION public.lookup_mail_thread_states(uuid[]) IS
  '過去データ取込用: thread_id の配列から現在の状態を返す(巻き戻し防止の基準値取得)。
   URL 長の制約を避けるため .in() の代わりに使う。CLAUDE.md §5.15';

GRANT EXECUTE ON FUNCTION public.lookup_mail_thread_states(uuid[]) TO authenticated;
