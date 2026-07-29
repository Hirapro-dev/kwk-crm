-- ============================================================================
-- migration 70: 会員に「備考」を追加 (2026-07)
--
-- 背景:
--   extract.csv (Salesforce 由来: 会員ID, 備考 の2列) に会員ごとの備考が含まれる
--   (23,764件中 1,371件に値あり)。既存会員 (members) に紐づけて保持したい
--   (CLAUDE.md §5.4)。
--
-- 対応:
--   - members に text 型カラム remarks を追加 (改行・URL含む複数行テキスト)。
--   - field_definitions に登録し、会員詳細画面に表示 (一覧は非表示)。
--   - 取込は scripts/import/06_members_remarks.ts (会員IDで突合、値のある行のみ更新)。
-- ============================================================================

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS remarks text;

COMMENT ON COLUMN public.members.remarks IS
  '備考 (extract.csv から会員IDで突合して取込。複数行テキスト)';

-- field_definitions: 会員詳細に表示 (一覧は非表示)。data_type=text。
INSERT INTO public.field_definitions
  (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system,
   sort_order_list, sort_order_detail, is_in_db)
VALUES
  ('members', 'remarks', '備考', 'text', false, true, false, 232, 62, true)
ON CONFLICT (object_id, field_name) DO UPDATE
  SET label = EXCLUDED.label, data_type = EXCLUDED.data_type, updated_at = now();
