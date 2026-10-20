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
--   このファイルを SQL Editor で実行する(数秒で終わる)。125 万通ぶんの索引作成は時間がかかるため(PGroonga は目安 10〜40 分)、
--   SQL Editor では作らず、pg_cron のジョブ(DB の中で動く。画面の接続が切れても止まらない)に任せる。
--   2026-10-19 に 1 回で全部を SQL Editor で実行したところ、索引作成の途中で「Failed to fetch」になり全体が取り消された。
--   索引は CONCURRENTLY で作るので、作成中もメールの受信(mail_messages への追加)は止まらない。
--   索引ができたら、末尾の「後片付け」の SQL でジョブを消す(索引ができる前でも検索は動くが遅い・時間切れになることがある)。
--   容量: 2026-10-19 時点で DB 3.8 GB、メール本文 約 2.3 GB。PGroonga の索引で数 GB 増える見込み。
-- ============================================================================

-- Supabase の作法どおり extensions スキーマに入れる(関数・演算子は search_path で参照する)
CREATE EXTENSION IF NOT EXISTS pgroonga WITH SCHEMA extensions;

-- 1) 差出人アドレスの索引(小文字)は、末尾の pg_cron ジョブで作る。宛先・CC は migration 106 の GIN 索引(lower_text_array)を使う

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

-- 3) 索引の作成を pg_cron のジョブに登録する(毎分起動。最初の起動で作成が始まり、作成中・作成後の起動は IF NOT EXISTS で何もしない)。
--    - 差出人アドレスの索引(btree)
--    - テキスト検索の索引(PGroonga。日本語は 2 文字ずつ区切って索引する。全角半角・大文字小文字は同一視)。
--      式は上の関数の WHERE と同じにすること(違うと索引が使われない)。
SELECT cron.schedule(
  'build_mail_from_lower_index',
  '* * * * *',
  $job$CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_messages_from_lower ON public.mail_messages (lower(from_address))$job$
);
SELECT cron.schedule(
  'build_mail_pgroonga_index',
  '* * * * *',
  $job$CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_messages_pgroonga ON public.mail_messages USING pgroonga ((ARRAY[subject, from_name, from_address, text_body]))$job$
);

-- ----------------------------------------------------------------------------
-- 後片付け(索引ができたのを確認してから、別に実行する):
--   SELECT cron.unschedule('build_mail_from_lower_index');
--   SELECT cron.unschedule('build_mail_pgroonga_index');
-- 作成状況の確認:
--   SELECT c.relname, i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
--    WHERE c.relname IN ('idx_mail_messages_from_lower', 'idx_mail_messages_pgroonga');
--   SELECT * FROM pg_stat_progress_create_index;
-- 作成に失敗して indisvalid = false の索引が残ったら、DROP INDEX CONCURRENTLY してからジョブに作り直させる。
-- ----------------------------------------------------------------------------
