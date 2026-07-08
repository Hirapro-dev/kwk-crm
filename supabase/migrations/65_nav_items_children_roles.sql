-- ============================================================================
-- nav_items に「親子関係」と「ロール別表示」を追加 + 出金管理メニューをシード (2026-07)
-- CLAUDE.md §5.10b 拡張 / §5.13
--
-- 目的:
--   1. parent_id: 親タブを指定すると、その項目は親タブのホバープルダウン内に表示される。
--   2. visible_roles: 表示を許可するロール群(text[])。NULL は全ロール表示。
--      管理画面 /settings/roles で編集する。
--   3. 「出金管理」親タブ + 「出金管理-親」「出金管理-子」の子項目をシード。
--      admin / manager / support のみ表示。
--
-- 影響範囲: nullable 列を2つ追加 + シード3行。冪等。
-- ============================================================================

ALTER TABLE public.nav_items
  ADD COLUMN IF NOT EXISTS parent_id text REFERENCES public.nav_items(id),
  ADD COLUMN IF NOT EXISTS visible_roles text[];

COMMENT ON COLUMN public.nav_items.parent_id IS
  '親タブID。指定時は親タブのホバープルダウン内に表示(トップレベルには出さない)';
COMMENT ON COLUMN public.nav_items.visible_roles IS
  '表示を許可するロール群。NULL は全ロール表示。/settings/roles で管理';

-- 出金管理メニュー(親 + 子2つ)。対応歴(45)と記事反応(47)の間: 46台は空いていないため 48 を使用。
-- 親タブの href は先頭の子と同じにして、クリックでも遷移できるようにする。
INSERT INTO nav_items (id, label, href, match_prefix, sort_order, is_visible, parent_id, visible_roles)
VALUES
  ('withdrawals', '出金管理', '/withdrawal-parents', false, 48, true, NULL,
   ARRAY['admin','manager','support']),
  ('withdrawal_parents', '出金管理-親', '/withdrawal-parents', true, 10, true, 'withdrawals',
   ARRAY['admin','manager','support']),
  ('withdrawal_children', '出金管理-子', '/withdrawal-children', true, 20, true, 'withdrawals',
   ARRAY['admin','manager','support'])
ON CONFLICT (id) DO UPDATE
  SET label = excluded.label, href = excluded.href,
      match_prefix = excluded.match_prefix, parent_id = excluded.parent_id,
      visible_roles = excluded.visible_roles;
