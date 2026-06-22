-- =============================================================================
-- Phase 2.5: field_definitions に is_placeholder カラムを追加
-- =============================================================================
-- 目的:
--   詳細レイアウトエディタで「空白セル」を配置できるようにする。
--   グリッドの位置調整(他のフィールドを右側/下側にずらす)に使用する純粋な
--   レイアウト用ダミーフィールド。
--
-- 仕様:
--   - is_placeholder=true のフィールドは:
--       - DB物理カラムを持たない (is_in_db=false)
--       - field_name は "__placeholder_<unix_ts>" のような自動生成名
--       - data_type='text' 固定
--       - 詳細画面 (DynamicDetailFields) では空の <div> として描画される
--       - 一覧画面では非表示 (is_visible_list=false 固定)
--   - レイアウトエディタの「+ 空白を追加」ボタンで作成、
--     削除ボタンで物理削除可能 (is_system=false)。
-- =============================================================================

ALTER TABLE public.field_definitions
  ADD COLUMN IF NOT EXISTS is_placeholder boolean NOT NULL DEFAULT false;

-- 空白セルは一覧では表示しない制約を補助するインデックス
CREATE INDEX IF NOT EXISTS idx_field_definitions_placeholder
  ON public.field_definitions(object_id, is_placeholder)
  WHERE is_placeholder = true;
