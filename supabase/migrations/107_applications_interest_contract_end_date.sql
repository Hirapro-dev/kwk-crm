-- ============================================================================
-- migration 107: 申込に「利息」と「契約期日」を追加する (2026-09-18)
--                CLAUDE.md §5.6 / §8.1 /applications
--
-- 背景(ユーザー要望):
--   申込の新規登録で「利息」を入力したい(既存の「円金利」yen_interest とは別の項目。円金利はそのまま残す)。
--   「契約期間」は 起算日時(既存 start_datetime)〜契約期日 で持ち、「●ヶ月」(既存 contract_period)は別に持つ。
--   契約期日の列が無いため追加する。
--
-- 方針:
--   - interest numeric(18,2)(利息。円)と contract_end_date date を追加(NULL 可。CSV 取込の対象外)。
--   - field_definitions に登録し、オブジェクト管理(/settings/objects/applications)で一覧/詳細の表示を
--     切り替えられるようにする(migration 75 と同方式。初期値は一覧 非表示 / 詳細 表示。
--     並びは 利息 → 円金利の直前、契約期日 → 起算日時の直後)。
-- ============================================================================

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS interest numeric(18,2),
  ADD COLUMN IF NOT EXISTS contract_end_date date;
COMMENT ON COLUMN public.applications.interest IS '利息(円)。円金利 yen_interest とは別の項目。migration 107';
COMMENT ON COLUMN public.applications.contract_end_date IS '契約期日(契約期間の終了日。起算日時 start_datetime 〜 契約期日)。migration 107';

INSERT INTO public.field_definitions
  (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system,
   sort_order_list, sort_order_detail, is_in_db, description)
VALUES
  ('applications', 'interest', '利息', 'number', false, true, true, 265, 255, true,
   '利息(円)。円金利とは別の項目。2026-09-18 追加(migration 107)'),
  ('applications', 'contract_end_date', '契約期日', 'date', false, true, true, 545, 125, true,
   '契約期間の終了日(起算日時〜契約期日)。2026-09-18 追加(migration 107)')
-- 再適用時に表示ON/OFF・並び順を上書きしない(migration 75 と同じ)
ON CONFLICT (object_id, field_name) DO UPDATE
  SET label       = EXCLUDED.label,
      data_type   = EXCLUDED.data_type,
      is_in_db    = EXCLUDED.is_in_db,
      is_system   = EXCLUDED.is_system,
      description = EXCLUDED.description,
      updated_at  = now();
