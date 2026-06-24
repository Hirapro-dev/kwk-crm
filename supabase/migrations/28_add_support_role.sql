-- ============================================================================
-- support ロールの追加
-- 仕様書 §7.1 拡張: sales と同等権限(担当分のみ読み書き)
-- ============================================================================

-- ① users.role の CHECK 制約を更新
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin','manager','sales','viewer','support'));

-- ② ヘルパ関数: sales / support どちらでも真になる判定
CREATE OR REPLACE FUNCTION public.is_sales_level()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role IN ('sales','support')
      AND deleted_at IS NULL
  );
$$;

-- ============================================================================
-- ③ 既存ポリシーを差し替え(DROP → CREATE)
--    sales を参照している全ポリシーに support を追加
-- ============================================================================

-- users_select_all
DROP POLICY IF EXISTS users_select_all ON public.users;
CREATE POLICY users_select_all ON public.users
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      id = auth.uid()
      OR public.can_read_all()
      OR public.is_sales_level()
    )
  );

-- members_select
DROP POLICY IF EXISTS members_select ON public.members;
CREATE POLICY members_select ON public.members
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      public.can_read_all()
      OR (
        public.is_sales_level()
        AND (owner_id = auth.uid() OR owner_id IS NULL)
      )
    )
  );

-- members_insert
DROP POLICY IF EXISTS members_insert ON public.members;
CREATE POLICY members_insert ON public.members
  FOR INSERT
  WITH CHECK (
    public.current_user_role() IN ('admin','manager','sales','support')
  );

-- members_update
DROP POLICY IF EXISTS members_update ON public.members;
CREATE POLICY members_update ON public.members
  FOR UPDATE
  USING (
    public.is_admin_or_manager()
    OR (
      public.is_sales_level()
      AND (owner_id = auth.uid() OR owner_id IS NULL)
    )
  )
  WITH CHECK (
    public.is_admin_or_manager()
    OR (
      public.is_sales_level()
      AND (owner_id = auth.uid() OR owner_id IS NULL)
    )
  );

-- inquiries_insert
DROP POLICY IF EXISTS inquiries_insert ON public.inquiries;
CREATE POLICY inquiries_insert ON public.inquiries
  FOR INSERT
  WITH CHECK (
    public.current_user_role() IN ('admin','manager','sales','support')
  );

-- inquiries_update
DROP POLICY IF EXISTS inquiries_update ON public.inquiries;
CREATE POLICY inquiries_update ON public.inquiries
  FOR UPDATE
  USING (
    public.is_admin_or_manager()
    OR (
      public.is_sales_level()
      AND (
        member_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.members m
          WHERE m.id = inquiries.member_id
            AND (m.owner_id = auth.uid() OR m.owner_id IS NULL)
        )
      )
    )
  )
  WITH CHECK (
    public.is_admin_or_manager()
    OR public.is_sales_level()
  );

-- applications_select
DROP POLICY IF EXISTS applications_select ON public.applications;
CREATE POLICY applications_select ON public.applications
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      public.can_read_all()
      OR (
        public.is_sales_level()
        AND EXISTS (
          SELECT 1 FROM public.members m
          WHERE m.id = applications.member_id
            AND (m.owner_id = auth.uid() OR m.owner_id IS NULL)
        )
      )
    )
  );

-- applications_insert
DROP POLICY IF EXISTS applications_insert ON public.applications;
CREATE POLICY applications_insert ON public.applications
  FOR INSERT
  WITH CHECK (
    public.current_user_role() IN ('admin','manager','sales','support')
  );

-- applications_update
DROP POLICY IF EXISTS applications_update ON public.applications;
CREATE POLICY applications_update ON public.applications
  FOR UPDATE
  USING (
    public.is_admin_or_manager()
    OR (
      public.is_sales_level()
      AND EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.id = applications.member_id
          AND (m.owner_id = auth.uid() OR m.owner_id IS NULL)
      )
    )
  )
  WITH CHECK (
    public.is_admin_or_manager()
    OR public.is_sales_level()
  );

-- activities_select
DROP POLICY IF EXISTS activities_select ON public.activities;
CREATE POLICY activities_select ON public.activities
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      public.can_read_all()
      OR (
        public.is_sales_level()
        AND (
          owner_id = auth.uid()
          OR created_by_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.members m
            WHERE m.id = activities.member_id
              AND (m.owner_id = auth.uid() OR m.owner_id IS NULL)
          )
        )
      )
    )
  );

-- activities_insert
DROP POLICY IF EXISTS activities_insert ON public.activities;
CREATE POLICY activities_insert ON public.activities
  FOR INSERT
  WITH CHECK (
    public.current_user_role() IN ('admin','manager','sales','support')
    AND (
      created_by_id IS NULL
      OR created_by_id = auth.uid()
      OR public.is_admin()
    )
  );

-- activities_update
DROP POLICY IF EXISTS activities_update ON public.activities;
CREATE POLICY activities_update ON public.activities
  FOR UPDATE
  USING (
    public.is_admin_or_manager()
    OR (
      public.is_sales_level()
      AND created_by_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_admin_or_manager()
    OR (
      public.is_sales_level()
      AND created_by_id = auth.uid()
    )
  );

-- report_folders_insert
DROP POLICY IF EXISTS report_folders_insert ON public.report_folders;
CREATE POLICY report_folders_insert ON public.report_folders
  FOR INSERT
  WITH CHECK (
    public.current_user_role() IN ('admin','manager','sales','viewer','support')
    AND created_by = auth.uid()
  );

-- reports_insert
DROP POLICY IF EXISTS reports_insert ON public.reports;
CREATE POLICY reports_insert ON public.reports
  FOR INSERT
  WITH CHECK (
    public.current_user_role() IN ('admin','manager','sales','viewer','support')
    AND created_by = auth.uid()
    AND is_standard = false
  );
