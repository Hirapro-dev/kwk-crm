-- ============================================================================
-- migration 79: メーラーのヘッダー検索(メールアドレス・キーワード) 用 RPC (2026-09)
--
-- 背景:
--   ヘッダー検索でメールアドレス・キーワードを対象に、mail_messages の
--   from_address / to_addresses / cc_addresses(配列)/ 件名 / 本文を横断して探す。
--   PostgREST の ilike フィルタは配列列(to_addresses/cc_addresses)に直接使えないため、
--   SQL 関数側で unnest して判定する(CLAUDE.md §5.15)。
--
-- 対応:
--   search_mail_thread_ids(p_pattern text, p_kind text): 一致するメッセージの
--   thread_id を重複無しで返す(最大5000件。呼び出し側でさらに mail_threads を
--   絞り込む)。p_kind は 'email' か 'keyword'。会員ID検索は mail_threads.member_id への
--   完全一致で済むため、この関数を使わず呼び出し側(lib/domain/mail.ts)で直接絞り込む。
--
--   ワイルドカード(%, _)のエスケープは TS 側の決定論的ロジックで行い
--   (lib/domain/mail_search.ts の escapeLikeWildcards)、この関数は渡された
--   パターンをそのまま ILIKE に使う。
--
--   SECURITY INVOKER(既定)。mail_messages の RLS(migration 76: 全ロール SELECT 可)が
--   そのまま効くため、権限を広げるものではない。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_mail_thread_ids(p_pattern text, p_kind text)
RETURNS TABLE (thread_id uuid)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT DISTINCT m.thread_id
  FROM public.mail_messages m
  WHERE
    (p_kind = 'email' AND (
      m.from_address ILIKE p_pattern
      OR EXISTS (SELECT 1 FROM unnest(m.to_addresses) a WHERE a ILIKE p_pattern)
      OR EXISTS (SELECT 1 FROM unnest(m.cc_addresses) a WHERE a ILIKE p_pattern)
    ))
    OR
    (p_kind = 'keyword' AND (
      m.subject ILIKE p_pattern
      OR m.text_body ILIKE p_pattern
      OR m.html_body ILIKE p_pattern
    ))
  LIMIT 5000;
$$;

COMMENT ON FUNCTION public.search_mail_thread_ids(text, text) IS
  'メーラーのヘッダー検索用: メールアドレス(from/to/cc)またはキーワード(件名/本文)に
   一致するメッセージの thread_id を返す(重複除去、最大5000件)。CLAUDE.md §5.15';

GRANT EXECUTE ON FUNCTION public.search_mail_thread_ids(text, text) TO authenticated;
