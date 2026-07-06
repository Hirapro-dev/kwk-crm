-- 記事反応リストのメニューを nav_items に追加 (2026-07) / CLAUDE.md §5.10b
-- 対応歴(sort_order=45)の後ろに配置。表示順は後から /settings/navigation で調整可。
INSERT INTO nav_items (id, label, href, match_prefix, sort_order, is_visible)
VALUES ('article_reactions', '記事反応リスト', '/article-reactions', true, 47, true)
ON CONFLICT (id) DO UPDATE
  SET label = excluded.label, href = excluded.href,
      match_prefix = excluded.match_prefix, sort_order = excluded.sort_order,
      is_visible = excluded.is_visible;
