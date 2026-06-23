-- ============================================================================
-- migration 19: 対応歴(activities)から所要時間(duration_minutes)を削除 (2026-06)
--   - ダッシュボードの対応時間累計表示も廃止したため、列自体を削除
--   - todo_time は別項目のため残す
-- ============================================================================

ALTER TABLE public.activities DROP COLUMN IF EXISTS duration_minutes;

-- フィールド管理に所要時間の定義が登録されていれば併せて削除
DELETE FROM public.field_definitions
 WHERE object_id = 'activities' AND field_name = 'duration_minutes';
