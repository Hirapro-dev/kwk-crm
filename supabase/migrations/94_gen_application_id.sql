-- ============================================================================
-- migration 94: 新規申込IDの M- 採番 (2026-09-16) / CLAUDE.md §5.6「申込の新規登録」
--
-- 背景:
--   申込一覧に新規登録機能を付ける。既存の gen_m_id()(migration 03)は 7 桁形式で MAX+1 方式のため、
--   実データ(9 桁ゼロ埋め。例 M-000051826、2026-09-16 時点で 47,776 件)に合わず、同時実行でも重複しうる。
--
-- 方針:
--   - 連番(sequence)で採番する(gen_member_id / gen_inquiry_id と同方式)。
--   - 開始番号は 1000000(M-001000000)。Salesforce 併用中は Salesforce も 5 万台の M- を振り続けるため、
--     離れた番号帯にして CSV 取込時の衝突(別の申込の上書き)を避ける(K-000100000 / TA-001000000 と同じ考え方)。
--   - 申込作成の Server Action から実行ユーザーの権限で呼ぶため authenticated に EXECUTE を許可
--     (採番するだけで applications への書込権限は広げない)。
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS public.applications_id_seq
  AS bigint
  START WITH 1000000
  MINVALUE 1000000
  NO CYCLE;

CREATE OR REPLACE FUNCTION public.gen_application_id()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT 'M-' || lpad(nextval('public.applications_id_seq')::text, 9, '0');
$$;

COMMENT ON FUNCTION public.gen_application_id() IS
  '新規申込IDを M- 形式(9桁ゼロ埋め)で採番する。M-001000000 から。CLAUDE.md §5.6';

GRANT USAGE ON SEQUENCE public.applications_id_seq TO authenticated;
GRANT EXECUTE ON FUNCTION public.gen_application_id() TO authenticated;
