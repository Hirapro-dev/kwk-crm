-- =============================================================================
-- メニューバー(ナビゲーション)項目マスタ (CLAUDE.md §5.10b)
-- =============================================================================
-- 目的:
--   上部横タブ(TabsNav)の表示順・表示有無を管理者が /settings/navigation で
--   変更できるようにする。これまで layout.tsx にハードコードしていた NAV_TABS を
--   DB 化し、システム全体で共通の並びとして永続化する。
--
-- 影響範囲:
--   - 新規テーブル nav_items を1つ追加するのみ。既存テーブルは触らない。
--   - RLS は全員 SELECT(レイアウト描画に必要)、admin のみ INSERT/UPDATE/DELETE。
--   - 未適用時はアプリ側(lib/domain/nav_items.ts)の既定リストにフォールバックする。
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.nav_items (
  id            text PRIMARY KEY,                 -- 安定キー (dashboard / members ...)
  label         text NOT NULL,                    -- タブ表示名
  href          text NOT NULL,                    -- 遷移先パス
  match_prefix  boolean NOT NULL DEFAULT false,   -- 下層パスでもアクティブ表示にするか
  sort_order    int NOT NULL DEFAULT 100,         -- 表示順
  is_visible    boolean NOT NULL DEFAULT true,    -- タブ表示ON/OFF
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nav_items_sort ON public.nav_items(sort_order);

-- 再実行しても安全なよう、トリガーは作り直す
DROP TRIGGER IF EXISTS trg_nav_items_updated_at ON public.nav_items;
CREATE TRIGGER trg_nav_items_updated_at
  BEFORE UPDATE ON public.nav_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========================================================
-- RLS: 全員 SELECT、admin のみ INSERT/UPDATE/DELETE
-- ========================================================
ALTER TABLE public.nav_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nav_items_select ON public.nav_items;
CREATE POLICY nav_items_select ON public.nav_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS nav_items_modify ON public.nav_items;
CREATE POLICY nav_items_modify ON public.nav_items
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin' AND u.deleted_at IS NULL)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin' AND u.deleted_at IS NULL)
  );

-- ========================================================
-- 初期シード: 現行 NAV_TABS
-- ========================================================
INSERT INTO public.nav_items (id, label, href, match_prefix, sort_order, is_visible) VALUES
  ('dashboard',    'ダッシュボード', '/',             false, 10, true),
  ('members',      '顧客情報',       '/members',      true,  20, true),
  ('inquiries',    '問合せ',         '/inquiries',    true,  30, true),
  ('applications', '申込',           '/applications', true,  40, true),
  ('summary',      'サマリ',         '/summary',      true,  50, true),
  ('reports',      'レポート',       '/reports',      true,  60, true)
ON CONFLICT (id) DO NOTHING;
