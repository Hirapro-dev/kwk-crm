-- ============================================================================
-- 対応歴(activities) SELECT ポリシーを全ロール全件閲覧に変更
-- 理由: 過去の対応履歴を把握した上で顧客対応するため、担当者制限を撤廃
-- ============================================================================

DROP POLICY IF EXISTS activities_select ON public.activities;

CREATE POLICY activities_select ON public.activities
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND public.current_user_role() IN ('admin','manager','sales','support','viewer')
  );
