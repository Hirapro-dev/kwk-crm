-- =============================================================================
-- 2026-05 仕様変更: projects.id を text(T-XXXXXXXXX) 形式に変更
-- =============================================================================
-- 背景:
--   案件マスタCSV (anken_csv.csv) の「案件ID」が "T-000000001" 形式の text。
--   外部システム (Salesforce) との整合性を保つため、DB 主キーもこの形式に統一する。
--
-- 影響範囲:
--   - public.projects.id: serial(int) → text に型変更
--   - public.applications.project_id: int → text に型変更 (FK 再構築)
--   - 既存の projects / applications / inquiries / members は一旦全削除
--     (新CSV から再投入するため)
--   - users / activities / forms / reports は触らない
--
-- 実行順序:
--   1. FK 制約を一時削除
--   2. 子テーブル (applications) を空にする
--   3. inquiries / members も空にする (FK 違反予防 + 再投入)
--   4. projects を空にする
--   5. id 型を text に変更
--   6. project_id 型を text に変更
--   7. FK 制約を再作成
-- =============================================================================

-- ========================================================
-- 1) 既存データ全削除 (projects / applications / inquiries / members)
--    activities は触らない (FK は member_id だけだが、CASCADE しない設計)
--    users は触らない
-- ========================================================

-- activities の member_id は ON DELETE SET NULL の想定だが、念のため確認
-- (activities テーブル本体は維持、紐付け情報のみリセット)
UPDATE public.activities SET member_id = NULL WHERE member_id IS NOT NULL;

-- 子から順に削除
TRUNCATE TABLE public.applications CASCADE;
TRUNCATE TABLE public.inquiries CASCADE;
TRUNCATE TABLE public.members CASCADE;
TRUNCATE TABLE public.projects RESTART IDENTITY CASCADE;

-- ========================================================
-- 2) projects.id を serial(int) → text に変更
-- ========================================================

-- 既存の FK 制約を削除 (applications.project_id → projects.id)
ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_project_id_fkey;

-- projects.id を text 型に変更
-- SERIAL の付随する sequence は CASCADE で削除
ALTER TABLE public.projects
  ALTER COLUMN id DROP DEFAULT;

DROP SEQUENCE IF EXISTS public.projects_id_seq CASCADE;

ALTER TABLE public.projects
  ALTER COLUMN id TYPE text USING id::text;

-- ========================================================
-- 3) applications.project_id を int → text に変更
-- ========================================================

ALTER TABLE public.applications
  ALTER COLUMN project_id TYPE text USING project_id::text;

-- ========================================================
-- 4) FK 制約を再作成
-- ========================================================

ALTER TABLE public.applications
  ADD CONSTRAINT applications_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id);

-- ========================================================
-- 完了
-- ========================================================
-- 次のステップ:
--   1. npm run import:projects     # anken_csv.csv 投入
--   2. npm run import:members      # kaiin_csv.csv 全件投入
--   3. npm run import:inquiries    # kawara_scv.csv + kimitsucp_csv.csv 投入
--   4. npm run import:applications # moushikomi_csv.csv 投入 (6ヶ月絞り)
