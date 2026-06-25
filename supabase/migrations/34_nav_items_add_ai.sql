-- nav_items に AI タブを追加 (CLAUDE.md §5.10b)
-- ボトムナビには既に存在するため、PCメニューバーにも追加する
INSERT INTO nav_items (id, label, href, match_prefix, sort_order, is_visible)
VALUES ('ai', 'AI', '/ai', false, 70, true)
ON CONFLICT (id) DO UPDATE SET
  label      = EXCLUDED.label,
  href       = EXCLUDED.href,
  sort_order = EXCLUDED.sort_order,
  is_visible = EXCLUDED.is_visible;
