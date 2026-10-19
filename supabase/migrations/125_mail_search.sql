-- ============================================================================
-- migration 125: メーラーの検索(メールアドレス検索・本文を含むテキスト検索) (2026-10-19)
--                CLAUDE.md §5.15「検索」
--
-- 目的:
--   これまでの検索はスレッドの件名の部分一致だけで、116 万スレッドに対して索引が無く実用にならなかった。
--   1) メールアドレス検索: そのアドレスが 差出人 / 宛先(To)/ CC のどれかに入っているメールのスレッドを、すべての受信箱から探す
--      (顧客とのやり取りを、自社のどの送信元アドレスからのものも含めて全部見る。2026-10-19 ユーザー要望)
--   2) テキスト検索: 件名・差出人名・差出人アドレス・本文(テキスト版)を全期間で探す(2026-10-19 ユーザー決定)。
--      日本語に向いた全文検索 PGroonga を使う(Supabase で利用可)。
--
-- 実行のしかた(本番):
--   ① この 1 ファイルを SQL Editor で実行する。② の PGroonga 索引の作成は 125 万通ぶんで時間がかかる(目安 10〜40 分)。
--   SQL Editor が途中で切れた場合は、最後の CREATE INDEX だけを psql などの接続から実行する。
--   索引ができるまでの間も検索は動くが、テキスト検索は遅い(タイムアウトすることがある)。
--   容量: 2026-10-19 時点で DB 3.8 GB、メール本文 約 2.3 GB。PGroonga の索引で数 GB 増える見込み。
-- ============================================================================

-- Supabase の作法どおり extensions スキーマに入れる(関数・演算子は search_path で参照する)
CREATE EXTENSION IF NOT EXISTS pgroonga WITH SCHEMA extensions;

-- 1) 差出人アドレスの索引(小文字)。宛先・CC は migration 106 の GIN 索引(lower_text_array)を使う
CREATE INDEX IF NOT EXISTS idx_mail_messages_from_lower
  ON public.mail_messages (lower(from_address));

-- 2) 検索本体。条件に一致したメールを含むスレッドを、最終メール日時の新しい順に最大 p_limit 件返す
--    (PostgREST の 1 回の上限 1,000 行に合わせ、既定 1000)。状態・受信箱などの絞り込みはアプリ側で行う。
--    SECURITY INVOKER(RLS をそのまま適用。メールの閲覧は全ロール)。
CREATE OR REPLACE FUNCTION public.search_mail_threads(
  p_mode  text,          -- 'address' | 'text'
  p_query text,
  p_limit integer DEFAULT 1000
)
RETURNS TABLE (
  id                  uuid,
  mail_box_id         integer,
  status              text,
  category            text,
  assignee_id         uuid,
  is_read             boolean,
  is_import_candidate boolean,
  last_message_at     timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_q text := btrim(coalesce(p_query, ''));
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 1000);
BEGIN
  IF v_q = '' THEN
    RETURN;
  END IF;

  IF p_mode = 'address' THEN
    v_q := lower(v_q);
    RETURN QUERY
      SELECT t.id, t.mail_box_id, t.status, t.category, t.assignee_id, t.is_read,
             t.is_import_candidate, t.last_message_at
        FROM public.mail_threads t
       WHERE t.deleted_at IS NULL
         AND t.id IN (
           SELECT m.thread_id FROM public.mail_messages m WHERE lower(m.from_address) = v_q
           UNION
           SELECT m.thread_id FROM public.mail_messages m
            WHERE public.lower_text_array(m.to_addresses) @> ARRAY[v_q]
           UNION
           SELECT m.thread_id FROM public.mail_messages m
            WHERE public.lower_text_array(m.cc_addresses) @> ARRAY[v_q]
         )
       ORDER BY t.last_message_at DESC NULLS LAST, t.id DESC
       LIMIT v_limit;
  ELSIF p_mode = 'text' THEN
    -- 空白区切りは AND。記号は検索構文として解釈しないようエスケープする
    RETURN QUERY
      SELECT t.id, t.mail_box_id, t.status, t.category, t.assignee_id, t.is_read,
             t.is_import_candidate, t.last_message_at
        FROM public.mail_threads t
       WHERE t.deleted_at IS NULL
         AND t.id IN (
           SELECT m.thread_id FROM public.mail_messages m
            WHERE ARRAY[m.subject, m.from_name, m.from_address, m.text_body]
                  &@~ pgroonga_query_escape(v_q)
         )
       ORDER BY t.last_message_at DESC NULLS LAST, t.id DESC
       LIMIT v_limit;
  ELSE
    RAISE EXCEPTION 'p_mode は address か text を指定してください';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.search_mail_threads(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_mail_threads(text, text, integer) TO authenticated, service_role;

-- 3) テキスト検索の索引(PGroonga。日本語は 2 文字ずつ区切って索引する。全角半角・大文字小文字は同一視)
--    時間がかかるため最後に置く。式は上の関数の WHERE と同じにすること(違うと索引が使われない)。
CREATE INDEX IF NOT EXISTS idx_mail_messages_pgroonga
  ON public.mail_messages
  USING pgroonga ((ARRAY[subject, from_name, from_address, text_body]));
