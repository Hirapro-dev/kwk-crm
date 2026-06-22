-- ============================================================================
-- 案件マスタ(projects)初期投入
-- 仕様書 §5.5: 44案件を seeds/projects.sql で列挙
-- 配置: supabase/migrations/04_seed_projects.sql
-- ============================================================================
-- ※実データから抽出した案件名・カテゴリは Phase 1 で移行スクリプト時に確定。
--   本ファイルはサンプル(代表的なカテゴリのみ)。実投入は scripts/migrate/02_projects.ts が行う。

-- カテゴリ別の代表サンプル(本番投入前のスキーマ検証用)
INSERT INTO public.projects (name, category, description) VALUES
  ('SAMPLE_COIN_ASEC',         'コイン',         'サンプル: ASECコイン'),
  ('SAMPLE_BOND_001',          '社債',           'サンプル: 社債案件1'),
  ('SAMPLE_LOAN_001',          '借入',           'サンプル: 借入案件1'),
  ('SAMPLE_FACTORING_001',     'ファクタリング',  'サンプル: ファクタリング案件1'),
  ('SAMPLE_BUSINESS_001',      '事業投資',       'サンプル: 事業投資案件1'),
  ('SAMPLE_OTHER_001',         'その他',         'サンプル: その他')
ON CONFLICT (name) DO NOTHING;

-- TODO(Phase 1): scripts/migrate/02_projects.ts により実際の44案件を投入し、
-- 投入確認後に上記サンプルは DELETE する。
