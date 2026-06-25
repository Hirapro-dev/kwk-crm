-- ============================================================================
-- RLSポリシー 全面整理
--
-- 新ルール:
--   SELECT  : 全ロール全件閲覧可 (admin/manager/sales/support/viewer)
--   INSERT/UPDATE : viewer以外 (admin/manager/sales/support)
--   DELETE  : admin のみ
--
-- ※ プロテクト項目(protect_by_user_id/protect_expires_at)の変更は
--    アプリ側で admin のみ操作可能な UI に制限済み。
-- ============================================================================

-- ============================================================================
-- helpers
-- ============================================================================

-- 書き込み可能ロール(viewer以外)
CREATE OR REPLACE FUNCTION public.can_write()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role IN ('admin','manager','sales','support')
      AND is_active = true
      AND deleted_at IS NULL
  );
$$;

-- ============================================================================
-- members
--   UPDATE/DELETE: admin 全件 OR 自分が owner_id のもの
-- ============================================================================

DROP POLICY IF EXISTS members_select      ON public.members;
DROP POLICY IF EXISTS members_insert      ON public.members;
DROP POLICY IF EXISTS members_update      ON public.members;
DROP POLICY IF EXISTS members_delete      ON public.members;

CREATE POLICY members_select ON public.members
  FOR SELECT USING (deleted_at IS NULL);

CREATE POLICY members_insert ON public.members
  FOR INSERT WITH CHECK (public.can_write());

CREATE POLICY members_update ON public.members
  FOR UPDATE
  USING (
    deleted_at IS NULL
    AND (
      public.is_admin()
      OR (public.can_write() AND owner_id = auth.uid())
    )
  )
  WITH CHECK (
    public.is_admin()
    OR (public.can_write() AND owner_id = auth.uid())
  );

CREATE POLICY members_delete ON public.members
  FOR DELETE USING (
    public.is_admin()
    OR (public.can_write() AND owner_id = auth.uid())
  );

-- ============================================================================
-- activities
--   UPDATE/DELETE: admin 全件 OR 自分が created_by_id のもの
-- ============================================================================

DROP POLICY IF EXISTS activities_select   ON public.activities;
DROP POLICY IF EXISTS activities_insert   ON public.activities;
DROP POLICY IF EXISTS activities_update   ON public.activities;
DROP POLICY IF EXISTS activities_delete   ON public.activities;

CREATE POLICY activities_select ON public.activities
  FOR SELECT USING (deleted_at IS NULL);

CREATE POLICY activities_insert ON public.activities
  FOR INSERT WITH CHECK (
    public.can_write()
    AND (created_by_id IS NULL OR created_by_id = auth.uid() OR public.is_admin())
  );

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

CREATE POLICY activities_delete ON public.activities
  FOR DELETE USING (
    public.is_admin()
    OR (public.can_write() AND (created_by_id = auth.uid() OR owner_id = auth.uid()))
  );

-- ============================================================================
-- applications
--   UPDATE/DELETE: admin 全件 OR 自分が owner_id のもの
-- ============================================================================

DROP POLICY IF EXISTS applications_select ON public.applications;
DROP POLICY IF EXISTS applications_insert ON public.applications;
DROP POLICY IF EXISTS applications_update ON public.applications;
DROP POLICY IF EXISTS applications_delete ON public.applications;

CREATE POLICY applications_select ON public.applications
  FOR SELECT USING (deleted_at IS NULL);

CREATE POLICY applications_insert ON public.applications
  FOR INSERT WITH CHECK (public.can_write());

CREATE POLICY applications_update ON public.applications
  FOR UPDATE
  USING (
    deleted_at IS NULL
    AND (
      public.is_admin()
      OR (public.can_write() AND owner_id = auth.uid())
    )
  )
  WITH CHECK (
    public.is_admin()
    OR (public.can_write() AND owner_id = auth.uid())
  );

CREATE POLICY applications_delete ON public.applications
  FOR DELETE USING (
    public.is_admin()
    OR (public.can_write() AND owner_id = auth.uid())
  );

-- ============================================================================
-- inquiries
--   created_by_id カラムなし → UPDATE/DELETE は admin のみ
--   (問合せは外部フォームからの流入が主で個人所有の概念が薄い)
-- ============================================================================

DROP POLICY IF EXISTS inquiries_select    ON public.inquiries;
DROP POLICY IF EXISTS inquiries_insert    ON public.inquiries;
DROP POLICY IF EXISTS inquiries_update    ON public.inquiries;
DROP POLICY IF EXISTS inquiries_delete    ON public.inquiries;

CREATE POLICY inquiries_select ON public.inquiries
  FOR SELECT USING (deleted_at IS NULL);

CREATE POLICY inquiries_insert ON public.inquiries
  FOR INSERT WITH CHECK (public.can_write());

CREATE POLICY inquiries_update ON public.inquiries
  FOR UPDATE
  USING    (deleted_at IS NULL AND public.can_write())
  WITH CHECK (public.can_write());

CREATE POLICY inquiries_delete ON public.inquiries
  FOR DELETE USING (public.is_admin());

-- ============================================================================
-- users (自分のプロフィール変更 or admin のみ)
-- ============================================================================

DROP POLICY IF EXISTS users_select_all    ON public.users;
DROP POLICY IF EXISTS users_insert        ON public.users;
DROP POLICY IF EXISTS users_update        ON public.users;
DROP POLICY IF EXISTS users_delete        ON public.users;

CREATE POLICY users_select_all ON public.users
  FOR SELECT USING (deleted_at IS NULL);

CREATE POLICY users_insert ON public.users
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY users_update ON public.users
  FOR UPDATE
  USING    (deleted_at IS NULL AND (id = auth.uid() OR public.is_admin()))
  WITH CHECK (id = auth.uid() OR public.is_admin());

CREATE POLICY users_delete ON public.users
  FOR DELETE USING (public.is_admin());

-- ============================================================================
-- projects / forms (admin のみ編集)
-- ============================================================================

DROP POLICY IF EXISTS projects_select ON public.projects;
DROP POLICY IF EXISTS projects_insert ON public.projects;
DROP POLICY IF EXISTS projects_update ON public.projects;
DROP POLICY IF EXISTS projects_delete ON public.projects;

CREATE POLICY projects_select ON public.projects FOR SELECT USING (true);
CREATE POLICY projects_insert ON public.projects FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY projects_update ON public.projects FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY projects_delete ON public.projects FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS forms_select ON public.forms;
DROP POLICY IF EXISTS forms_insert ON public.forms;
DROP POLICY IF EXISTS forms_update ON public.forms;
DROP POLICY IF EXISTS forms_delete ON public.forms;

CREATE POLICY forms_select ON public.forms FOR SELECT USING (true);
CREATE POLICY forms_insert ON public.forms FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY forms_update ON public.forms FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY forms_delete ON public.forms FOR DELETE USING (public.is_admin());

-- ============================================================================
-- flow_rules (admin のみ編集 - プロテクト日数設定)
-- ============================================================================

DROP POLICY IF EXISTS flow_rules_select ON public.flow_rules;
DROP POLICY IF EXISTS flow_rules_insert ON public.flow_rules;
DROP POLICY IF EXISTS flow_rules_update ON public.flow_rules;
DROP POLICY IF EXISTS flow_rules_delete ON public.flow_rules;

CREATE POLICY flow_rules_select ON public.flow_rules FOR SELECT USING (true);
CREATE POLICY flow_rules_insert ON public.flow_rules FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY flow_rules_update ON public.flow_rules FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY flow_rules_delete ON public.flow_rules FOR DELETE USING (public.is_admin());
