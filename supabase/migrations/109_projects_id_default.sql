-- ============================================================================
-- migration 109: 案件マスタ(projects)の ID 自動採番を復活し、「MRT_0.01%借入」を登録する (2026-09-18)
--                CLAUDE.md §5.5 / §8.1 /projects
--
-- 背景:
--   migration 09 で projects.id を serial → text(T-XXXXXXXXX。Salesforce の案件ID)に変えたときに
--   列の DEFAULT が外れ、画面(/settings/projects「新規案件を追加」)から追加すると
--   「null value in column "id" of relation "projects" violates not-null constraint」で失敗していた
--   (CSV 取込は Salesforce の ID を持ってくるので気づかなかった)。
--
-- 方針(会員 K- / 問合せ TA- / 申込 M- と同じ):
--   - 連番 projects_id_seq と関数 gen_project_id()('T-' || 9 桁ゼロ埋め)を追加し、id の DEFAULT にする。
--   - 開始番号は 1000000(T-001000000)。Salesforce 併用中は Salesforce も T-0000000xx を振り続けるため、
--     離れた番号帯にして案件 CSV 取込時の衝突(別案件の上書き)を避ける。
--   - 「MRT_0.01%借入」(2026-09-18 の申込 CSV にある案件)をこの採番で登録する(名前が既にあれば何もしない)。
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS public.projects_id_seq START WITH 1000000;

CREATE OR REPLACE FUNCTION public.gen_project_id()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT 'T-' || lpad(nextval('public.projects_id_seq')::text, 9, '0')
$$;
COMMENT ON FUNCTION public.gen_project_id() IS
  '案件マスタの ID 採番(T-001000000 から)。画面からの新規追加用。CSV 取込は Salesforce の ID をそのまま使う。CLAUDE.md §5.5';

ALTER TABLE public.projects ALTER COLUMN id SET DEFAULT public.gen_project_id();

INSERT INTO public.projects (name, is_active)
VALUES ('MRT_0.01%借入', true)
ON CONFLICT (name) DO NOTHING;
