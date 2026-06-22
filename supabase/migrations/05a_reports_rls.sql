-- ============================================================================
-- レポート関連テーブルの RLS
-- 仕様書 §9.14
-- 配置: supabase/migrations/05a_reports_rls.sql
-- 前提: 05_reports_schema.sql 適用済み、02a_rls_policies.sql のヘルパ関数定義済み
-- ============================================================================

-- ============================================================================
-- RLS 有効化
-- ============================================================================
ALTER TABLE public.report_folders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_runs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_subscriptions   ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- report_folders
--   visibility=public : 全員 SELECT
--   visibility=team   : 全ログインユーザー SELECT
--   visibility=private: 作成者のみ SELECT
-- ============================================================================
CREATE POLICY report_folders_select ON public.report_folders
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      visibility IN ('public','team')
      OR created_by = auth.uid()
      OR public.is_admin()
    )
  );

CREATE POLICY report_folders_insert ON public.report_folders
  FOR INSERT
  WITH CHECK (
    public.current_user_role() IN ('admin','manager','sales','viewer')
    AND created_by = auth.uid()
  );

CREATE POLICY report_folders_update ON public.report_folders
  FOR UPDATE
  USING (created_by = auth.uid() OR public.is_admin())
  WITH CHECK (created_by = auth.uid() OR public.is_admin());

-- ============================================================================
-- reports
-- ============================================================================
CREATE POLICY reports_select ON public.reports
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      visibility IN ('public','team')
      OR created_by = auth.uid()
      OR public.is_admin()
    )
  );

CREATE POLICY reports_insert ON public.reports
  FOR INSERT
  WITH CHECK (
    public.current_user_role() IN ('admin','manager','sales','viewer')
    AND created_by = auth.uid()
    AND is_standard = false  -- 標準レポートはマイグレーション(service_role)経由でのみ作成
  );

CREATE POLICY reports_update ON public.reports
  FOR UPDATE
  USING (
    (created_by = auth.uid() AND is_standard = false)
    OR public.is_admin()
  )
  WITH CHECK (
    (created_by = auth.uid() AND is_standard = false)
    OR public.is_admin()
  );

-- ============================================================================
-- report_runs (実行履歴)
-- 自分の実行履歴 + 自分が閲覧可能なレポートの履歴
-- ============================================================================
CREATE POLICY report_runs_select ON public.report_runs
  FOR SELECT
  USING (
    executed_by = auth.uid()
    OR public.is_admin_or_manager()
  );

CREATE POLICY report_runs_insert ON public.report_runs
  FOR INSERT
  WITH CHECK (executed_by = auth.uid());

-- ============================================================================
-- report_subscriptions (定期実行)
-- 自分の購読のみ
-- ============================================================================
CREATE POLICY report_subscriptions_select ON public.report_subscriptions
  FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY report_subscriptions_all ON public.report_subscriptions
  FOR ALL
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- ============================================================================
-- 補足
-- ============================================================================
-- 仕様書 §9.14:
--   レポート実行結果には実行ユーザーのRLSが適用される。
--   つまり sales が「全会員サマリ」を実行しても、自分担当+Free担当しか表示されない。
--   これは reports テーブル自体のRLSではなく、レポートの内部クエリが
--   members/activities/applications テーブルに対して RLS を経由するため自然に達成される。
