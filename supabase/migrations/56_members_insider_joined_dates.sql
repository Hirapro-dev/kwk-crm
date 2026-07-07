-- ============================================================================
-- migration 56: 会員に「XELS/SCT インサイダークラブ入会日」を追加 (2026-07)
--
-- 背景:
--   extract.csv (Salesforce 由来) に会員ごとの2つの入会日が含まれる。
--     - XELSインサイダークラブ入会日  (2,154件に値あり)
--     - SCTインサイダークラブ入会日   (1,895件に値あり)
--   これらを既存会員 (members) に紐づけて保持したい (CLAUDE.md §5.4)。
--
-- 対応:
--   - members に date 型カラム2本を追加。
--   - field_definitions に登録し、会員詳細画面に表示 (一覧は非表示)。
--   - 取込は scripts/import/05_members_insider_dates.ts (会員IDで突合、値のある行のみ更新)。
-- ============================================================================

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS xels_insider_joined_at date,
  ADD COLUMN IF NOT EXISTS sct_insider_joined_at  date;

COMMENT ON COLUMN public.members.xels_insider_joined_at IS
  'XELSインサイダークラブ入会日 (extract.csv から取込)';
COMMENT ON COLUMN public.members.sct_insider_joined_at IS
  'SCTインサイダークラブ入会日 (extract.csv から取込)';

-- field_definitions: 会員詳細に表示 (一覧は非表示)。data_type=date。
INSERT INTO public.field_definitions
  (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system,
   sort_order_list, sort_order_detail, is_in_db)
VALUES
  ('members', 'xels_insider_joined_at', 'XELSインサイダークラブ入会日', 'date', false, true, false, 230, 60, true),
  ('members', 'sct_insider_joined_at',  'SCTインサイダークラブ入会日',  'date', false, true, false, 231, 61, true)
ON CONFLICT (object_id, field_name) DO UPDATE
  SET label = EXCLUDED.label, data_type = EXCLUDED.data_type, updated_at = now();
