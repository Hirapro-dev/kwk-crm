-- ============================================================================
-- migration 126: メーラーのテキスト検索を「件名・差出人名」にする (2026-10-20)
--                CLAUDE.md §5.15「検索」
--
-- 経緯:
--   migration 125 で本文まで対象にした全文検索(PGroonga)の索引を作ろうとしたが、作成中に DB のサーバー処理が
--   再起動して止まった(メモリ不足の可能性が高い。2026-10-20 10:45 頃)。作りかけの索引・ジョブは削除済み。
--   ユーザー決定(2026-10-20): テキスト検索は件名・差出人名を対象にする(本文は対象外。必要なら DB を一時的に大きくして別途)。
--
-- 方針:
--   - 索引は pg_trgm(既に入っている。会員氏名の検索と同じ方式)。作成時のメモリは maintenance_work_mem までに収まる
--   - 3 文字以上: スレッドの件名 + メールの差出人名 を索引で探す
--   - 1〜2 文字: pg_trgm の索引が使えないため、スレッドの件名だけを探す(全件を見ても約 3 秒。差出人名まで見ると 10 秒かかり時間切れになる)
--   - メールアドレス検索(p_mode = 'address')は migration 125 のまま
--
-- 実行のしかた(本番):
--   このファイルを SQL Editor で実行する(数秒)。索引 2 つは、末尾の「索引の作成」の手順でジョブに作らせる(1 つずつ)。
-- ============================================================================

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
  v_like text;
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
    -- 部分一致(大文字小文字は区別しない)。% と _ は文字として扱う
    v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    IF char_length(v_q) >= 3 THEN
      RETURN QUERY
        SELECT t.id, t.mail_box_id, t.status, t.category, t.assignee_id, t.is_read,
               t.is_import_candidate, t.last_message_at
          FROM public.mail_threads t
         WHERE t.deleted_at IS NULL
           AND (
             t.subject ILIKE v_like
             OR t.id IN (SELECT m.thread_id FROM public.mail_messages m WHERE m.from_name ILIKE v_like)
           )
         ORDER BY t.last_message_at DESC NULLS LAST, t.id DESC
         LIMIT v_limit;
    ELSE
      RETURN QUERY
        SELECT t.id, t.mail_box_id, t.status, t.category, t.assignee_id, t.is_read,
               t.is_import_candidate, t.last_message_at
          FROM public.mail_threads t
         WHERE t.deleted_at IS NULL
           AND t.subject ILIKE v_like
         ORDER BY t.last_message_at DESC NULLS LAST, t.id DESC
         LIMIT v_limit;
    END IF;
  ELSE
    RAISE EXCEPTION 'p_mode は address か text を指定してください';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.search_mail_threads(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_mail_threads(text, text, integer) TO authenticated, service_role;

-- PGroonga は使わなくなったので外す(索引・関数から参照していないこと)
DROP EXTENSION IF EXISTS pgroonga;

-- 索引の作成: 時間がかかるため pg_cron のジョブに作らせる(1 つずつ。同時に作るとお互いを待って止まる)。
-- ジョブの 2 分の時間制限を作成中だけ外す(終わったら RESET する)。
ALTER ROLE postgres SET statement_timeout = 0;
SELECT cron.schedule(
  'build_mail_threads_subject_trgm',
  '* * * * *',
  $job$CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_threads_subject_trgm ON public.mail_threads USING gin (subject gin_trgm_ops)$job$
);

-- ----------------------------------------------------------------------------
-- 手順 2(件名の索引ができてから実行):
--   SELECT cron.unschedule('build_mail_threads_subject_trgm');
--   SELECT cron.schedule('build_mail_messages_from_name_trgm', '* * * * *',
--     $job$CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_messages_from_name_trgm ON public.mail_messages USING gin (from_name gin_trgm_ops)$job$);
-- 後片付け(差出人名の索引ができてから実行):
--   SELECT cron.unschedule('build_mail_messages_from_name_trgm');
--   ALTER ROLE postgres RESET statement_timeout;
-- ----------------------------------------------------------------------------
