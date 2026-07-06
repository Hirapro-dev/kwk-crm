-- ============================================================================
-- migration 54: レポートに「指定ユーザーのみ」公開範囲を追加 (2026-07)
--
-- 背景:
--   既存の visibility は private(自分) / team(全ログイン) / public(全社) の3種。
--   admin が「admin + 指定した特定ユーザーのみ閲覧可」に制限したいケースに対応する。
--
-- 対応:
--   - visibility に 'restricted' を追加。
--   - 閲覧許可ユーザーIDを保持する shared_with uuid[] を追加。
--   - reports_select に restricted の閲覧条件(shared_with に自分が含まれる)を追加。
--   - restricted の設定(INSERT/UPDATE)は admin のみ許可(WITH CHECK)。
-- ============================================================================

-- 1) 閲覧許可ユーザーリスト
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS shared_with uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

COMMENT ON COLUMN public.reports.shared_with IS
  'visibility=restricted のとき閲覧を許可するユーザーID群(admin は常に閲覧可)';

CREATE INDEX IF NOT EXISTS idx_reports_shared_with_gin
  ON public.reports USING gin(shared_with);

-- 2) visibility CHECK に 'restricted' を追加
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_visibility_check;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_visibility_check
  CHECK (visibility IN ('private', 'team', 'public', 'restricted'));

-- 3) SELECT ポリシー: restricted は shared_with に自分が含まれる場合のみ閲覧可
DROP POLICY IF EXISTS reports_select ON public.reports;
CREATE POLICY reports_select ON public.reports
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      visibility IN ('public', 'team')
      OR created_by = auth.uid()
      OR public.is_admin()
      OR (visibility = 'restricted' AND auth.uid() = ANY(shared_with))
    )
  );

-- 4) INSERT/UPDATE: restricted に設定できるのは admin のみ
DROP POLICY IF EXISTS reports_insert ON public.reports;
CREATE POLICY reports_insert ON public.reports
  FOR INSERT
  WITH CHECK (
    public.current_user_role() IN ('admin', 'manager', 'sales', 'viewer')
    AND created_by = auth.uid()
    AND is_standard = false
    AND (visibility <> 'restricted' OR public.is_admin())
  );

DROP POLICY IF EXISTS reports_update ON public.reports;
CREATE POLICY reports_update ON public.reports
  FOR UPDATE
  USING (
    (created_by = auth.uid() AND is_standard = false)
    OR public.is_admin()
  )
  WITH CHECK (
    (
      (created_by = auth.uid() AND is_standard = false)
      OR public.is_admin()
    )
    AND (visibility <> 'restricted' OR public.is_admin())
  );
