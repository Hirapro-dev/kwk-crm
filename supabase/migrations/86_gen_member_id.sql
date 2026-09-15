-- ============================================================================
-- migration 86: 新規会員IDの K- 採番 (2026-09-15) / CLAUDE.md §5.16「会員IDの採番」
--
-- 背景:
--   会員化(convertInquiryToMember)の新規会員は 2026-05 以降 UUID を採番していたが、
--   会員IDは K- 形式(9桁ゼロ埋め)で統一する方針に変更(2026-09-15 決定)。
--   これまで UUID で作られた会員は存在しない(2026-09-15 時点で K- 以外の ID は 0 件)。
--
-- 方針:
--   - 連番(sequence)で採番する。gen_ta_id() の MAX+1 方式と違い、同時実行でも重複しない。
--   - 開始番号は 100000(K-000100000)。Salesforce 併用中は Salesforce も 2 万台の K- を
--     振り続ける(2026-09-15 時点の最大は K-000025047)ため、離れた番号帯にして
--     CSV 取込時の衝突(別人の上書き)を避ける。
--   - 会員化の Server Action から実行ユーザーの権限で呼ぶため authenticated に EXECUTE を許可
--     (採番するだけで members への書込権限は広げない)。
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS public.members_id_seq
  AS bigint
  START WITH 100000
  MINVALUE 100000
  NO CYCLE;

CREATE OR REPLACE FUNCTION public.gen_member_id()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT 'K-' || lpad(nextval('public.members_id_seq')::text, 9, '0');
$$;

COMMENT ON FUNCTION public.gen_member_id() IS
  '新規会員IDを K- 形式(9桁ゼロ埋め)で採番する。K-000100000 から。CLAUDE.md §5.16';

GRANT USAGE ON SEQUENCE public.members_id_seq TO authenticated;
GRANT EXECUTE ON FUNCTION public.gen_member_id() TO authenticated;
