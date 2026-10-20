-- ============================================================================
-- migration 127: メーラーのテキスト検索(3 文字以上)を速くする (2026-10-20)
--                CLAUDE.md §5.15「検索」
--
-- migration 126 の「件名 OR 差出人名」は、件名だけ(0.1 秒)・差出人名だけ(0.8 秒)なら速いのに、組み合わせると
-- DB が「新しい順の索引を頭から全部たどって条件を確かめる」やり方を選び、8 秒で時間切れになっていた
-- (一致が少ない言葉ほど遅い)。先に件名・差出人名それぞれの索引で一致スレッドを集め(MATERIALIZED)、
-- その後で新しい順に並べる形に書き換える。アドレス検索・1〜2 文字の検索は変えない。
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
        WITH hit AS MATERIALIZED (
          SELECT t2.id AS thread_id FROM public.mail_threads t2 WHERE t2.subject ILIKE v_like
          UNION
          SELECT m.thread_id FROM public.mail_messages m WHERE m.from_name ILIKE v_like
        )
        SELECT t.id, t.mail_box_id, t.status, t.category, t.assignee_id, t.is_read,
               t.is_import_candidate, t.last_message_at
          FROM hit h
          JOIN public.mail_threads t ON t.id = h.thread_id
         WHERE t.deleted_at IS NULL
         ORDER BY t.last_message_at DESC NULLS LAST, t.id DESC
         LIMIT v_limit;
    ELSE
      -- 1〜2 文字は pg_trgm の索引が使えないため件名だけ(新しい順にたどって 1,000 件で止める。全件でも約 3 秒)
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

-- 索引作成のジョブと、外していた時間制限の後片付け(差出人名の索引は 2026-10-20 13:24 に完成済み)
SELECT cron.unschedule('build_mail_messages_from_name_trgm');
ALTER ROLE postgres RESET statement_timeout;
