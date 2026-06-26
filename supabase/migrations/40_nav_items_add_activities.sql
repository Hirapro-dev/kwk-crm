-- 対応歴メニューを nav_items に追加 (2026-06) / CLAUDE.md §5.10b
INSERT INTO nav_items (id, label, href, match_prefix, sort_order, is_visible)
VALUES ('activities', '対応歴', '/activities', true, 45, true)
ON CONFLICT (id) DO UPDATE
  SET label = excluded.label, href = excluded.href,
      match_prefix = excluded.match_prefix, sort_order = excluded.sort_order,
      is_visible = excluded.is_visible;
