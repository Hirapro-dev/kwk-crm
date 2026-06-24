-- =============================================================================
-- field_definitions: 永久担当 / プロテクト ラベル整理
-- =============================================================================
-- 変更内容:
--   1. owner_name_raw のラベルを「プロテクト」→「永久担当」に修正
--      (CSVの「永久担当」列と対応しているため)
--   2. owner_id の field_definitions 行を削除
--      (画面表示上 owner_name_raw と重複するため)
--      ※ owner_id カラム自体は RLS / ダッシュボード / フィルターで使用中のため削除しない
-- =============================================================================

-- 1. owner_name_raw のラベル修正
UPDATE public.field_definitions
SET
  label      = '永久担当',
  updated_at = now()
WHERE object_id   = 'members'
  AND field_name  = 'owner_name_raw';

-- 2. owner_id の表示行を削除(is_system=false の場合のみ削除可)
--    is_system=true の場合も含めて削除したい場合は FORCE で対応
DELETE FROM public.field_definitions
WHERE object_id  = 'members'
  AND field_name = 'owner_id';
