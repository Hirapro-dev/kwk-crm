-- ============================================================================
-- 記事反応リスト: オブジェクト管理メタデータのシード (2026-07)
-- CLAUDE.md §5.8 object_definitions / §5.9 field_definitions
--
-- migration 10 と同じ形式で、object_definitions に1行、
-- field_definitions に代表カラムを投入する。
-- これにより一覧/詳細の動的描画(DynamicListTable / DynamicDetailFields)に載る。
-- ============================================================================

-- 1) オブジェクト本体(forms=70 の次: 80)
INSERT INTO public.object_definitions (id, label, icon_label, icon_color, sort_order, is_system) VALUES
  ('article_reactions', '記事反応リスト', 'ART', '#00C896', 80, true)
ON CONFLICT (id) DO NOTHING;

-- 2) 代表カラム(すべて is_system=true / 実DBカラム)
INSERT INTO public.field_definitions (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system, sort_order_list, sort_order_detail) VALUES
  ('article_reactions', 'id',                  '反応ID',       'text', true,  true,  true, 10,  10),
  ('article_reactions', 'reacted_date',        '日付',         'date', true,  true,  true, 20,  20),
  ('article_reactions', 'member_id',           '会員ID',       'text', true,  true,  true, 30,  30),
  ('article_reactions', 'member_name',         '会員氏名',     'text', true,  true,  true, 40,  40),
  ('article_reactions', 'media',               '配信媒体',     'text', true,  true,  true, 50,  50),
  ('article_reactions', 'tool',                '配信ツール',   'text', true,  true,  true, 60,  60),
  ('article_reactions', 'reaction_type',       '種類',         'text', true,  true,  true, 70,  70),
  ('article_reactions', 'form_name',           'フォーム名',   'text', false, true,  true, 80,  80),
  ('article_reactions', 'detail',              '詳細',         'text', true,  true,  true, 90,  90),
  ('article_reactions', 'member_legacy_sf_id', '旧SF会員ID',   'text', false, true,  true, 100, 100)
ON CONFLICT (object_id, field_name) DO NOTHING;
