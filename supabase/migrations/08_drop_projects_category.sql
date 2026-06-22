-- =============================================================================
-- 2026-05 仕様変更: projects.category を廃止
-- =============================================================================
-- 背景:
--   案件一覧画面のカラムから「カテゴリ」を除外することになり、CLAUDE.md §5.5 から
--   category カラムの定義そのものを削除した。
--   レポート定義(reports.definition jsonb)からも p.category への参照を除外する。
--
-- 影響範囲:
--   - public.projects.category カラム DROP
--   - public.idx_projects_category インデックス DROP
--   - 標準レポート RT10「案件別 申込件数・金額」の definition から
--     c2 カラム(p.category) と group_by level=2 を除去
-- =============================================================================

-- 1) インデックス削除 (カラム DROP より先)
DROP INDEX IF EXISTS public.idx_projects_category;

-- 2) カラム削除
ALTER TABLE public.projects DROP COLUMN IF EXISTS category;

-- 3) 標準レポート RT10 の definition を更新して category 列を除去
--    既存の columns/group_by から該当エントリを削除する。
UPDATE public.reports
SET definition = jsonb_set(
  definition,
  '{columns}',
  (
    SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
    FROM jsonb_array_elements(definition->'columns') elem
    WHERE elem->>'source' <> 'p.category'
  )
)
WHERE report_type = 'RT10'
  AND is_standard = true
  AND definition ? 'columns';

UPDATE public.reports
SET definition = jsonb_set(
  definition,
  '{group_by}',
  (
    SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
    FROM jsonb_array_elements(definition->'group_by') elem
    WHERE elem->>'field' <> 'p.category'
  )
)
WHERE report_type = 'RT10'
  AND is_standard = true
  AND definition ? 'group_by';

-- 4) ユーザー作成済みレポートで p.category を参照しているものは手動修正が必要。
--    検出用クエリ(実行しないがコメントとして残す):
--    SELECT id, name FROM public.reports
--    WHERE definition::text LIKE '%p.category%';
