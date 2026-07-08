-- ============================================================================
-- 出金管理-親/子 (withdrawal_parents / withdrawal_children) テーブル追加 (2026-07)
-- CLAUDE.md §5.13 に準拠
--
-- 目的:
--   SF出金管理システム元データCSV(【親】取込用 / 【子】取込用)を取込専用
--   オブジェクトとして保持する。元CSV列をそのままカラム化し、会員ID(K-)で
--   members に紐付ける。子は償還-親No(SO-)で親に紐付ける。
--
-- 方針(既存テーブル共通):
--   - 元ID(SO-/SC-)を主キーに温存(text)。再取込しても id で突合し重複しない。
--   - 論理削除(deleted_at)。物理削除は行わない。
--   - created_at/updated_at + set_updated_at トリガー。
--   - RLS: 出金情報は機微のため SELECT は admin/manager/support のみ。
--     書込は admin のみ(取込はサービスロールで実行するため RLS を迂回できる)。
-- ============================================================================

-- 1) 出金管理-親 (1行 = 1償還枠)
CREATE TABLE IF NOT EXISTS public.withdrawal_parents (
  id                  text PRIMARY KEY,                    -- 償還-親No (SO-XXXXXX)
  member_id           text REFERENCES public.members(id),  -- 会員ID (K-)。無ければ NULL
  member_name         text,                                -- 会員氏名スナップショット
  project_name        text,                                -- 投資案件(名称のまま保持)
  campaign            text,                                -- ｷｬﾝﾍﾟｰﾝ名
  principal           numeric(18,2),                       -- 元金
  profit              numeric(18,2),                       -- 利益
  total_amount        numeric(18,2),                       -- 元利合計
  management_label    text,                                -- 出金管理【親】
  member_legacy_sf_id text,                                -- SFID (0015i…)
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

-- 2) 出金管理-子 (1行 = 1回の出金)
CREATE TABLE IF NOT EXISTS public.withdrawal_children (
  id                  text PRIMARY KEY,                    -- 償還-子No (SC-XXXXXX)
  parent_no           text,                                -- 償還-親No 原文(常に保持)
  parent_id           text REFERENCES public.withdrawal_parents(id), -- 実在時のみ紐付け
  member_id           text REFERENCES public.members(id),  -- 会員ID (K-)。無ければ NULL
  member_name         text,                                -- 会員氏名スナップショット
  project_name        text,                                -- 投資案件
  campaign            text,                                -- ｷｬﾝﾍﾟｰﾝ名
  withdrawal_date     date,                                -- 出金日
  amount              numeric(18,2),                       -- 出金額
  management_label    text,                                -- 出金管理【子】
  member_legacy_sf_id text,                                -- セールスフォースＩＤ (0015i…)
  legacy_parent_sf_id text,                                -- 償還管理ID親 (a0d…)
  legacy_sf_id        text,                                -- 償還管理ID子
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

-- 会員詳細・親詳細からの参照用インデックス
CREATE INDEX IF NOT EXISTS idx_wparent_member ON public.withdrawal_parents(member_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wchild_member  ON public.withdrawal_children(member_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wchild_parent  ON public.withdrawal_children(parent_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wchild_date    ON public.withdrawal_children(withdrawal_date DESC) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_withdrawal_parents_updated_at
  BEFORE UPDATE ON public.withdrawal_parents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_withdrawal_children_updated_at
  BEFORE UPDATE ON public.withdrawal_children
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- RLS: SELECT は admin/manager/support のみ / 書込は admin のみ
-- ============================================================================
ALTER TABLE public.withdrawal_parents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_children ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wparent_select ON public.withdrawal_parents;
DROP POLICY IF EXISTS wparent_insert ON public.withdrawal_parents;
DROP POLICY IF EXISTS wparent_update ON public.withdrawal_parents;
DROP POLICY IF EXISTS wparent_delete ON public.withdrawal_parents;

CREATE POLICY wparent_select ON public.withdrawal_parents
  FOR SELECT USING (
    deleted_at IS NULL
    AND public.current_user_role() IN ('admin', 'manager', 'support')
  );
CREATE POLICY wparent_insert ON public.withdrawal_parents
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY wparent_update ON public.withdrawal_parents
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY wparent_delete ON public.withdrawal_parents
  FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS wchild_select ON public.withdrawal_children;
DROP POLICY IF EXISTS wchild_insert ON public.withdrawal_children;
DROP POLICY IF EXISTS wchild_update ON public.withdrawal_children;
DROP POLICY IF EXISTS wchild_delete ON public.withdrawal_children;

CREATE POLICY wchild_select ON public.withdrawal_children
  FOR SELECT USING (
    deleted_at IS NULL
    AND public.current_user_role() IN ('admin', 'manager', 'support')
  );
CREATE POLICY wchild_insert ON public.withdrawal_children
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY wchild_update ON public.withdrawal_children
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY wchild_delete ON public.withdrawal_children
  FOR DELETE USING (public.is_admin());
