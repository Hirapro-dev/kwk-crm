-- ============================================================================
-- migration 18: 「活動」→「対応歴」リネーム (2026-06)
--   - object_definitions / field_definitions の表示ラベルを更新
--   - 既定ラベルのままの行だけを更新し、管理画面でユーザーが編集した値は壊さない
--   - 物理テーブル名(activities)・カラム名は変更しない(表示名のみ)
-- ============================================================================

-- オブジェクト表示名: 活動履歴 → 対応歴
UPDATE public.object_definitions
   SET label = '対応歴', updated_at = now()
 WHERE id = 'activities' AND label = '活動履歴';

-- フィールド表示名: 活動ID → 対応歴ID (他のラベルは既定が中立的なため変更不要)
UPDATE public.field_definitions
   SET label = '対応歴ID', updated_at = now()
 WHERE object_id = 'activities' AND field_name = 'id' AND label = '活動ID';
