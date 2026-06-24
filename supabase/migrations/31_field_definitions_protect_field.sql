-- =============================================================================
-- field_definitions: プロテクトフィールドを members オブジェクトに追加
-- =============================================================================
-- 変更内容:
--   1. protect_by_user_id を「プロテクト」として追加
--      - is_visible_highlight=true (ハイライトパネルで表示)
--      - is_visible_detail=true (詳細画面でも表示)
--      - is_visible_list=false (一覧は管理者が必要に応じてON)
--      - レポートビルダーでも選択可能になる
--   2. owner_name_raw (永久担当) のハイライト表示をOFF
--      (プロテクトと重複しないようにハイライトパネルから外す)
-- =============================================================================

-- 1. protect_by_user_id フィールドを追加 (既存行がなければ)
INSERT INTO public.field_definitions (
  object_id,
  field_name,
  label,
  data_type,
  is_visible_list,
  is_visible_detail,
  is_visible_highlight,
  is_system,
  is_custom,
  is_in_db,
  sort_order_list,
  sort_order_detail,
  sort_order_highlight
)
VALUES (
  'members',
  'protect_by_user_id',
  'プロテクト',
  'text',
  false,
  true,
  true,
  true,
  false,
  true,
  100,
  35,
  10
)
ON CONFLICT (object_id, field_name) DO UPDATE
  SET
    label                = EXCLUDED.label,
    is_visible_highlight = EXCLUDED.is_visible_highlight,
    is_visible_detail    = EXCLUDED.is_visible_detail,
    sort_order_highlight = EXCLUDED.sort_order_highlight,
    sort_order_detail    = EXCLUDED.sort_order_detail,
    updated_at           = now();

-- 2. owner_name_raw のハイライトをOFF
UPDATE public.field_definitions
SET
  is_visible_highlight = false,
  updated_at           = now()
WHERE object_id  = 'members'
  AND field_name = 'owner_name_raw';
