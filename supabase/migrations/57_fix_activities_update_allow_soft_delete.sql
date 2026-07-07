-- ============================================================================
-- migration 57: 対応歴(activities)の論理削除を許可する RLS 修正 (2026-07)
--
-- 背景:
--   本番の activities_update ポリシーの WITH CHECK が「deleted_at IS NULL」を
--   要求していたため、deleted_at をセットする論理削除が
--   「new row violates row-level security policy」で弾かれていた。
--   (通常フィールドの編集は deleted_at が NULL のままなので通っていた)
--
-- 対応(migration 33 の意図に揃える):
--   - USING は deleted_at IS NULL を維持(削除済み行の再更新は不可)。
--   - WITH CHECK は「権限のみ」にし deleted_at 条件を持たせない
--     → admin もしくは作成者/担当者は論理削除(deleted_at セット)ができる。
-- ============================================================================

DROP POLICY IF EXISTS activities_update ON public.activities;
CREATE POLICY activities_update ON public.activities
  FOR UPDATE
  USING (
    deleted_at IS NULL
    AND (
      public.is_admin()
      OR (public.can_write() AND (created_by_id = auth.uid() OR owner_id = auth.uid()))
    )
  )
  WITH CHECK (
    public.is_admin()
    OR (public.can_write() AND (created_by_id = auth.uid() OR owner_id = auth.uid()))
  );
