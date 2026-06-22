-- =============================================================================
-- Phase 1.5: field_definitions に CSV カラムを管理するためのカラム追加
-- =============================================================================
-- 目的:
--   全 CSV カラム (members ~170 列等) を field_definitions で管理するため、
--   2 カラム追加して CSV由来かDB物理由来かを区別できるようにする。
--
-- 追加カラム:
--   - csv_column_name: 元の CSV ヘッダー文字列 (例: "ASEC利用額")
--   - is_in_db:        DB に物理カラムが存在するか (Phase 1.5 では false=extra予定)
-- =============================================================================

-- 1) カラム追加
ALTER TABLE public.field_definitions
  ADD COLUMN IF NOT EXISTS csv_column_name text,
  ADD COLUMN IF NOT EXISTS is_in_db boolean NOT NULL DEFAULT true;

-- 2) 既存システムカラムは全て is_in_db=true (シードで既に投入済みのもの)
UPDATE public.field_definitions
  SET is_in_db = true
WHERE is_system = true AND is_in_db IS NULL;

-- インデックス (CSV列名から逆引きする時用)
CREATE INDEX IF NOT EXISTS idx_field_definitions_csv ON public.field_definitions(object_id, csv_column_name)
  WHERE csv_column_name IS NOT NULL;

-- ========================================================
-- 完了
-- ========================================================
-- 次のステップ:
--   1. npm run seed:fields  # 全CSV ヘッダーから field_definitions に UPSERT
--   2. /settings/objects/[id] で全カラムが見える
