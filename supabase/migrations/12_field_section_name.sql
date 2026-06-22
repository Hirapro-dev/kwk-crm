-- =============================================================================
-- Phase 2.5: field_definitions に section_name カラムを追加
-- =============================================================================
-- 目的:
--   詳細レイアウトエディタでフィールドをセクション (グループ) に分けて表示するため、
--   各フィールドに所属セクション名を持たせる。
--
-- 例:
--   members: section_name = "基本情報" / "連絡先" / "取引情報" / null (未分類)
--
-- 表示優先順:
--   1) sort_order_detail で全体並び替え (セクション順序もここで決まる)
--   2) section_name が同じフィールドが連続する → セクションタイトル表示
--   3) section_name=null は「その他」として最後に表示 or タイトルなしで表示
-- =============================================================================

ALTER TABLE public.field_definitions
  ADD COLUMN IF NOT EXISTS section_name text;

-- インデックス (セクション別検索の高速化)
CREATE INDEX IF NOT EXISTS idx_field_definitions_section
  ON public.field_definitions(object_id, section_name)
  WHERE section_name IS NOT NULL;
