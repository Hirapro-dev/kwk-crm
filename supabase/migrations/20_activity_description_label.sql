-- ============================================================================
-- migration 20: 対応歴のフィールド表示名「コメント」→「対応詳細」(2026-06)
--   - 既定ラベルのままの行だけ更新(管理画面でユーザーが編集した値は壊さない)
--   - 対応歴のデータ項目: 接触種別(d_bunrui) / 接触内容(m_bunrui) / 状態(s_bunrui)
--     / 日時(registered_datetime) / 対応詳細(description)
-- ============================================================================

UPDATE public.field_definitions
   SET label = '対応詳細', updated_at = now()
 WHERE object_id = 'activities' AND field_name = 'description' AND label = 'コメント';
