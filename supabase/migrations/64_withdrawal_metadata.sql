-- ============================================================================
-- 出金管理-親/子: オブジェクト管理メタデータのシード (2026-07)
-- CLAUDE.md §5.8 object_definitions / §5.9 field_definitions / §5.13
--
-- migration 51 (記事反応リスト) と同じ形式で、object_definitions に2行、
-- field_definitions に代表カラムを投入する。
-- これにより一覧/詳細の動的描画(DynamicListTable / DynamicDetailFields)に載る。
-- ============================================================================

-- 1) オブジェクト本体(article_reactions=80 の次: 90, 91)
INSERT INTO public.object_definitions (id, label, icon_label, icon_color, sort_order, is_system) VALUES
  ('withdrawal_parents',  '出金管理-親', 'WDP', '#e05a5a', 90, true),
  ('withdrawal_children', '出金管理-子', 'WDC', '#e08a5a', 91, true)
ON CONFLICT (id) DO NOTHING;

-- 2) 代表カラム(すべて is_system=true / 実DBカラム)
INSERT INTO public.field_definitions (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system, sort_order_list, sort_order_detail) VALUES
  ('withdrawal_parents', 'id',                  '償還-親No',    'text',   true,  true,  true, 10,  10),
  ('withdrawal_parents', 'member_id',           '会員ID',       'text',   true,  true,  true, 20,  20),
  ('withdrawal_parents', 'member_name',         '会員氏名',     'text',   true,  true,  true, 30,  30),
  ('withdrawal_parents', 'project_name',        '投資案件',     'text',   true,  true,  true, 40,  40),
  ('withdrawal_parents', 'campaign',            'キャンペーン名', 'text',  true,  true,  true, 50,  50),
  ('withdrawal_parents', 'principal',           '元金',         'number', true,  true,  true, 60,  60),
  ('withdrawal_parents', 'profit',              '利益',         'number', true,  true,  true, 70,  70),
  ('withdrawal_parents', 'total_amount',        '元利合計',     'number', true,  true,  true, 80,  80),
  ('withdrawal_parents', 'management_label',    '出金管理【親】', 'text',  false, true,  true, 90,  90),
  ('withdrawal_parents', 'member_legacy_sf_id', 'SFID',         'text',   false, true,  true, 100, 100)
ON CONFLICT (object_id, field_name) DO NOTHING;

INSERT INTO public.field_definitions (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system, sort_order_list, sort_order_detail) VALUES
  ('withdrawal_children', 'id',                  '償還-子No',      'text',   true,  true,  true, 10,  10),
  ('withdrawal_children', 'parent_no',           '償還-親No',      'text',   true,  true,  true, 20,  20),
  ('withdrawal_children', 'member_id',           '会員ID',         'text',   true,  true,  true, 30,  30),
  ('withdrawal_children', 'member_name',         '会員氏名',       'text',   true,  true,  true, 40,  40),
  ('withdrawal_children', 'project_name',        '投資案件',       'text',   true,  true,  true, 50,  50),
  ('withdrawal_children', 'campaign',            'キャンペーン名',  'text',   true,  true,  true, 60,  60),
  ('withdrawal_children', 'withdrawal_date',     '出金日',         'date',   true,  true,  true, 70,  70),
  ('withdrawal_children', 'amount',              '出金額',         'number', true,  true,  true, 80,  80),
  ('withdrawal_children', 'management_label',    '出金管理【子】',  'text',   false, true,  true, 90,  90),
  ('withdrawal_children', 'member_legacy_sf_id', 'セールスフォースID', 'text', false, true,  true, 100, 100),
  ('withdrawal_children', 'legacy_parent_sf_id', '償還管理ID親',   'text',   false, true,  true, 110, 110),
  ('withdrawal_children', 'legacy_sf_id',        '償還管理ID子',   'text',   false, true,  true, 120, 120)
ON CONFLICT (object_id, field_name) DO NOTHING;
