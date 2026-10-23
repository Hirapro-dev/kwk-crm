-- ============================================================================
-- migration 130: 旧社債管理の編集・自動計算・次の期の作成 (2026-10-23)
--                CLAUDE.md §5.13c「編集・自動計算・次の期の自動作成」
--
-- 目的(担当者の回答 2026-10-21 とユーザー決定):
--   - 海外法人名義の行は源泉徴収しない → 行ごとの「源泉徴収なし」を持つ(次の期に引き継ぐ)
--   - 継続したら次の期の行を CRM で作る → 新しい行の ID の採番と、元の行 → 次の期 のリンクを持つ
--
-- 内容:
--   1. withholding_exempt(源泉徴収なし)/ next_bond_id(この行から作った次の期)を追加
--   2. 新しい行の ID: gen_legacy_bond_id()(KS- + 9 桁。KS-001000000 から。Salesforce の KS-0000000xx と離す)
--   3. KS-000000002(海外法人名義。源泉税 0 円)に源泉徴収なしを設定
--   4. 既存の「全額継続」の行と次の期の行を、計算どおり 1 対 1 に決まるものだけ結び付ける
--      (同じ申込・次の行の前回継続元金 = 今回の償還金額・次の償還対象月 = 今回の月 + 年数 + 1 か月)
--   5. 項目管理に 2 列を登録(詳細に表示)
-- ============================================================================

ALTER TABLE public.legacy_bonds
  ADD COLUMN IF NOT EXISTS withholding_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE public.legacy_bonds
  ADD COLUMN IF NOT EXISTS next_bond_id text REFERENCES public.legacy_bonds(id);
COMMENT ON COLUMN public.legacy_bonds.withholding_exempt IS '源泉徴収なし(海外法人名義)。true なら源泉税 0 円。次の期に引き継ぐ';
COMMENT ON COLUMN public.legacy_bonds.next_bond_id IS 'この行から作った次の期(継続)。二重作成の防止';

-- 1 つの行を 2 つの行の次の期にしない
CREATE UNIQUE INDEX IF NOT EXISTS uq_lbond_next_bond
  ON public.legacy_bonds(next_bond_id) WHERE next_bond_id IS NOT NULL;

-- 新しい行の ID(K- / TA- / M- / T- と同じく、Salesforce 併用中の衝突を避けて離れた番号帯から)
CREATE SEQUENCE IF NOT EXISTS public.legacy_bonds_id_seq START WITH 1000000;
CREATE OR REPLACE FUNCTION public.gen_legacy_bond_id()
RETURNS text
LANGUAGE sql
AS $$
  SELECT 'KS-' || lpad(nextval('public.legacy_bonds_id_seq')::text, 9, '0')
$$;
ALTER TABLE public.legacy_bonds ALTER COLUMN id SET DEFAULT public.gen_legacy_bond_id();

-- 海外法人名義(担当者回答: 海外法人名義のものは源泉徴収しない)
UPDATE public.legacy_bonds SET withholding_exempt = true WHERE id = 'KS-000000002';

-- 既存の継続と次の期を結び付ける(1 対 1 に決まるものだけ)
WITH cand AS (
  SELECT a.id AS src, b.id AS dst,
         count(*) OVER (PARTITION BY a.id) AS n_src,
         count(*) OVER (PARTITION BY b.id) AS n_dst
  FROM public.legacy_bonds a
  JOIN public.legacy_bonds b
    ON b.application_id = a.application_id
   AND b.id <> a.id
   AND b.deleted_at IS NULL
   AND b.prev_principal = a.redemption_amount
   AND b.redemption_month = to_char(
         to_date(a.redemption_month || '/01', 'YYYY/MM/DD') + make_interval(months => b.prev_years * 12 + 1),
         'YYYY/MM')
  WHERE a.deleted_at IS NULL
    AND a.result = '全額継続'
    AND a.next_bond_id IS NULL
)
UPDATE public.legacy_bonds t
   SET next_bond_id = c.dst
  FROM cand c
 WHERE t.id = c.src AND c.n_src = 1 AND c.n_dst = 1;

-- 項目管理(詳細に表示。一覧には出さない)
INSERT INTO public.field_definitions (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system, sort_order_list, sort_order_detail) VALUES
  ('legacy_bonds', 'withholding_exempt', '源泉徴収なし（海外法人名義）', 'boolean', false, true, true, 145, 145),
  ('legacy_bonds', 'next_bond_id',       '次の期',                       'text',    false, true, true, 210, 210)
ON CONFLICT (object_id, field_name) DO NOTHING;
