-- ============================================================================
-- 旧社債管理(legacy_bonds)テーブル追加 (2026-09-25)
-- CLAUDE.md §5.13c
--
-- 目的:
--   Salesforce の「旧社債管理」(旧社債の継続・償還の管理。1 行 = 1 償還対象月の 1 申込)を
--   取込専用オブジェクトとして保持する。閲覧は admin のみ。
--
-- 元CSVヘッダー → カラム対応:
--   旧社債管理ID → id(KS-…) / 会員ID → member_id(実在時のみ) / 会員氏名 → member_name /
--   申込ID → application_no(原文) + application_id(実在時のみ) / 案件 → project_name(原文) + project_id(名前で解決) /
--   社債名 → bond_name / 入金額 → payment_amount / 償還対象月 → redemption_month(YYYY/MM) /
--   償還金額 → redemption_amount / 前回継続元金 → prev_principal / 前回継続年数 → prev_years /
--   前回継続利息（年） → prev_interest_rate(%) / 利息 → interest / 源泉税 → withholding_tax /
--   今回の結果 → result / 契約書送付日 → contract_sent_date / 一部継続金額 → partial_continue_amount /
--   一部償還金額 → partial_redemption_amount / 銀行情報 → bank_info
--
-- 方針(出金管理 §5.13 と同じ):
--   - 元ID(KS-…)を主キーに温存。再取込しても id で突合し重複しない。
--   - 論理削除(deleted_at)。created_at/updated_at + set_updated_at トリガー。
--   - RLS: SELECT / 書込 とも admin のみ(取込はサービスロール)。
--   - object_definitions / field_definitions / nav_items(admin のみ表示)に登録。
--   - 一覧からの一括削除(§5.14)の対象に加える(soft_delete_records に分岐追加)。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.legacy_bonds (
  id                        text PRIMARY KEY,                          -- 旧社債管理ID (KS-…)
  member_id                 text REFERENCES public.members(id),        -- 会員ID (K-)。無ければ NULL
  member_name               text,                                      -- 会員氏名スナップショット
  application_no            text,                                      -- 申込ID 原文 (M-…)
  application_id            text REFERENCES public.applications(id),   -- 実在時のみ紐付け
  project_name              text,                                      -- 案件(名称のまま保持)
  project_id                text REFERENCES public.projects(id),       -- 案件名で解決(実在時のみ)
  bond_name                 text,                                      -- 社債名
  payment_amount            numeric(18,2),                             -- 入金額
  redemption_month          text,                                      -- 償還対象月 (YYYY/MM)
  redemption_amount         numeric(18,2),                             -- 償還金額
  prev_principal            numeric(18,2),                             -- 前回継続元金
  prev_years                integer,                                   -- 前回継続年数
  prev_interest_rate        numeric(8,2),                              -- 前回継続利息（年）%
  interest                  numeric(18,2),                             -- 利息
  withholding_tax           numeric(18,2),                             -- 源泉税
  result                    text,                                      -- 今回の結果(全額継続 / 回答待ち / 回答待ち（未） / 全額償還 …)
  contract_sent_date        date,                                      -- 契約書送付日
  partial_continue_amount   numeric(18,2),                             -- 一部継続金額
  partial_redemption_amount numeric(18,2),                             -- 一部償還金額
  bank_info                 text,                                      -- 銀行情報
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz
);

CREATE INDEX IF NOT EXISTS idx_lbond_member      ON public.legacy_bonds(member_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lbond_application ON public.legacy_bonds(application_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lbond_month       ON public.legacy_bonds(redemption_month DESC) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_legacy_bonds_updated_at
  BEFORE UPDATE ON public.legacy_bonds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: admin のみ(閲覧も書込も)
ALTER TABLE public.legacy_bonds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lbond_select ON public.legacy_bonds;
DROP POLICY IF EXISTS lbond_insert ON public.legacy_bonds;
DROP POLICY IF EXISTS lbond_update ON public.legacy_bonds;
DROP POLICY IF EXISTS lbond_delete ON public.legacy_bonds;
CREATE POLICY lbond_select ON public.legacy_bonds
  FOR SELECT USING (deleted_at IS NULL AND public.is_admin());
CREATE POLICY lbond_insert ON public.legacy_bonds
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY lbond_update ON public.legacy_bonds
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY lbond_delete ON public.legacy_bonds
  FOR DELETE USING (public.is_admin());

-- オブジェクト管理(出金管理 -親 90 / -子 91 / LP 92 の次)
INSERT INTO public.object_definitions (id, label, icon_label, icon_color, sort_order, is_system) VALUES
  ('legacy_bonds', '旧社債管理', 'BND', '#8a5ae0', 95, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.field_definitions (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system, sort_order_list, sort_order_detail) VALUES
  ('legacy_bonds', 'id',                        '旧社債管理ID',       'text',   true,  true,  true, 10,  10),
  ('legacy_bonds', 'member_id',                 '会員ID',             'text',   true,  true,  true, 20,  20),
  ('legacy_bonds', 'member_name',               '会員氏名',           'text',   true,  true,  true, 30,  30),
  ('legacy_bonds', 'application_no',            '申込ID',             'text',   true,  true,  true, 40,  40),
  ('legacy_bonds', 'project_name',              '案件',               'text',   false, true,  true, 50,  50),
  ('legacy_bonds', 'bond_name',                 '社債名',             'text',   true,  true,  true, 60,  60),
  ('legacy_bonds', 'payment_amount',            '入金額',             'number', true,  true,  true, 70,  70),
  ('legacy_bonds', 'redemption_month',          '償還対象月',         'text',   true,  true,  true, 80,  80),
  ('legacy_bonds', 'redemption_amount',         '償還金額',           'number', true,  true,  true, 90,  90),
  ('legacy_bonds', 'prev_principal',            '前回継続元金',       'number', false, true,  true, 100, 100),
  ('legacy_bonds', 'prev_years',                '前回継続年数',       'number', false, true,  true, 110, 110),
  ('legacy_bonds', 'prev_interest_rate',        '前回継続利息（年）', 'number', false, true,  true, 120, 120),
  ('legacy_bonds', 'interest',                  '利息',               'number', true,  true,  true, 130, 130),
  ('legacy_bonds', 'withholding_tax',           '源泉税',             'number', false, true,  true, 140, 140),
  ('legacy_bonds', 'result',                    '今回の結果',         'text',   true,  true,  true, 150, 150),
  ('legacy_bonds', 'contract_sent_date',        '契約書送付日',       'date',   true,  true,  true, 160, 160),
  ('legacy_bonds', 'partial_continue_amount',   '一部継続金額',       'number', false, true,  true, 170, 170),
  ('legacy_bonds', 'partial_redemption_amount', '一部償還金額',       'number', false, true,  true, 180, 180),
  ('legacy_bonds', 'bank_info',                 '銀行情報',           'text',   false, true,  true, 190, 190)
ON CONFLICT (object_id, field_name) DO NOTHING;

-- メニュー(admin のみ表示。出金管理(48)の次)
INSERT INTO nav_items (id, label, href, match_prefix, sort_order, is_visible, parent_id, visible_roles)
VALUES ('legacy_bonds', '旧社債管理', '/legacy-bonds', true, 49, true, NULL, ARRAY['admin']::text[])
ON CONFLICT (id) DO UPDATE
  SET label = excluded.label, href = excluded.href, match_prefix = excluded.match_prefix, visible_roles = excluded.visible_roles;

-- 一覧からの一括削除(§5.14 / migration 73 / 95)に legacy_bonds を追加
CREATE OR REPLACE FUNCTION public.soft_delete_records(p_object text, p_ids text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_ids constant integer := 500;
  v_count   integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  IF array_length(p_ids, 1) > v_max_ids THEN
    RAISE EXCEPTION 'too many ids: % (max %)', array_length(p_ids, 1), v_max_ids;
  END IF;

  -- p_object はここで許可済みの値のみに分岐する。
  -- テーブル名を文字列連結して EXECUTE することはしない。
  CASE p_object
    WHEN 'members' THEN
      UPDATE public.members
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    WHEN 'inquiries' THEN
      UPDATE public.inquiries
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    WHEN 'applications' THEN
      UPDATE public.applications
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    WHEN 'article_reactions' THEN
      UPDATE public.article_reactions
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    WHEN 'withdrawal_parents' THEN
      UPDATE public.withdrawal_parents
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    WHEN 'withdrawal_children' THEN
      UPDATE public.withdrawal_children
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    WHEN 'lp_entries' THEN
      UPDATE public.lp_entries
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    WHEN 'legacy_bonds' THEN
      UPDATE public.legacy_bonds
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    ELSE
      RAISE EXCEPTION 'unknown object: %', p_object;
  END CASE;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
