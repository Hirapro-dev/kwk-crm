-- ============================================================================
-- Row Level Security ポリシー(本実装)
-- 仕様書 §7.1, §7.2 に基づく
-- 配置: supabase/migrations/02a_rls_policies.sql
-- 前提: 01_schema.sql / 02_rls_policies.sql (RLS有効化のみ) 適用済み
-- 補足: 02_rls_policies.sql は Phase 0 のプレースホルダ。
--       仕様書 §12.3 「既存ファイル編集禁止」に従い、本実装は別ファイル(02a)で追加。
-- ============================================================================
--
-- ロール:
--   admin   : 全件読み書き、ユーザー管理
--   manager : 全件閲覧、自部署活動の編集
--   sales   : 自分担当の会員/申込/活動のみ読み書き、Free担当(owner_id IS NULL)は閲覧可
--   viewer  : 全件閲覧のみ
--
-- 設計原則:
--   - 物理削除禁止(DELETE ポリシー定義なし=拒否)。論理削除は UPDATE SET deleted_at で実施
--   - sales は自分の owner_id または NULL(Free担当) を見られる
--   - admin / manager / viewer は全件 SELECT 可
-- ============================================================================

-- ============================================================================
-- ヘルパ関数群(02_rls_policies.sql の current_user_role() は既に存在)
-- ============================================================================

-- 現ユーザーが admin かどうか
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL
  );
$$;

-- 現ユーザーが admin or manager かどうか
CREATE OR REPLACE FUNCTION public.is_admin_or_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role IN ('admin','manager')
      AND deleted_at IS NULL
  );
$$;

-- 現ユーザーが全件 SELECT 権限を持つか(admin/manager/viewer)
CREATE OR REPLACE FUNCTION public.can_read_all()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role IN ('admin','manager','viewer')
      AND deleted_at IS NULL
  );
$$;

-- ============================================================================
-- users (従業員) ポリシー
-- ============================================================================
-- 全ロールが従業員一覧を見られる(担当者選択UI / 表示で必要)
CREATE POLICY users_select_all ON public.users
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      id = auth.uid()
      OR public.can_read_all()
      OR public.current_user_role() = 'sales'
    )
  );

CREATE POLICY users_insert_admin ON public.users
  FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY users_update_admin ON public.users
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 自分のプロフィールは自身でも更新可(role は変更させない)
CREATE POLICY users_update_self ON public.users
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = (SELECT role FROM public.users WHERE id = auth.uid())
  );

-- ============================================================================
-- forms (フォームマスタ) ポリシー
-- 全ロール SELECT 可、admin のみ書き込み可
-- ============================================================================
CREATE POLICY forms_select_all ON public.forms
  FOR SELECT
  USING (true);

CREATE POLICY forms_write_admin ON public.forms
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================================
-- projects (案件マスタ) ポリシー
-- 全ロール SELECT 可、admin のみ書き込み可(仕様書 §8.1)
-- ============================================================================
CREATE POLICY projects_select_all ON public.projects
  FOR SELECT
  USING (true);

CREATE POLICY projects_write_admin ON public.projects
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================================
-- members (会員) ポリシー  -- 仕様書 §7.2
-- ============================================================================
CREATE POLICY members_select ON public.members
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      public.can_read_all()
      OR (
        public.current_user_role() = 'sales'
        AND (owner_id = auth.uid() OR owner_id IS NULL)
      )
    )
  );

CREATE POLICY members_insert ON public.members
  FOR INSERT
  WITH CHECK (
    public.current_user_role() IN ('admin','manager','sales')
  );

CREATE POLICY members_update ON public.members
  FOR UPDATE
  USING (
    public.is_admin_or_manager()
    OR (
      public.current_user_role() = 'sales'
      AND (owner_id = auth.uid() OR owner_id IS NULL)
    )
  )
  WITH CHECK (
    public.is_admin_or_manager()
    OR (
      public.current_user_role() = 'sales'
      AND (owner_id = auth.uid() OR owner_id IS NULL)
    )
  );

-- ============================================================================
-- inquiries (問合せ) ポリシー  -- 仕様書 §7.2
-- 全 sales が SELECT 可(まだ担当割当前のため)、UPDATE は manager と自身が担当者の場合のみ
-- ============================================================================
CREATE POLICY inquiries_select ON public.inquiries
  FOR SELECT
  USING (deleted_at IS NULL);

CREATE POLICY inquiries_insert ON public.inquiries
  FOR INSERT
  WITH CHECK (
    public.current_user_role() IN ('admin','manager','sales')
  );

CREATE POLICY inquiries_update ON public.inquiries
  FOR UPDATE
  USING (
    public.is_admin_or_manager()
    OR (
      public.current_user_role() = 'sales'
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
    OR public.current_user_role() = 'sales'
  );

-- ============================================================================
-- applications (申込) ポリシー
-- sales: 自分担当の会員に紐づく申込のみ
-- admin/manager/viewer: 全件 SELECT
-- ============================================================================
CREATE POLICY applications_select ON public.applications
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      public.can_read_all()
      OR (
        public.current_user_role() = 'sales'
        AND EXISTS (
          SELECT 1 FROM public.members m
          WHERE m.id = applications.member_id
            AND (m.owner_id = auth.uid() OR m.owner_id IS NULL)
        )
      )
    )
  );

CREATE POLICY applications_insert ON public.applications
  FOR INSERT
  WITH CHECK (
    public.current_user_role() IN ('admin','manager','sales')
  );

CREATE POLICY applications_update ON public.applications
  FOR UPDATE
  USING (
    public.is_admin_or_manager()
    OR (
      public.current_user_role() = 'sales'
      AND EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.id = applications.member_id
          AND (m.owner_id = auth.uid() OR m.owner_id IS NULL)
      )
    )
  )
  WITH CHECK (
    public.is_admin_or_manager()
    OR public.current_user_role() = 'sales'
  );

-- ============================================================================
-- activities (活動履歴) ポリシー  -- 仕様書 §7.2
-- sales: 自分担当会員の活動 or 自分作成のみ
-- admin/manager: 全件 SELECT、編集も可
-- viewer: 全件 SELECT のみ
-- ============================================================================
CREATE POLICY activities_select ON public.activities
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      public.can_read_all()
      OR (
        public.current_user_role() = 'sales'
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

CREATE POLICY activities_insert ON public.activities
  FOR INSERT
  WITH CHECK (
    public.current_user_role() IN ('admin','manager','sales')
    AND (
      created_by_id IS NULL
      OR created_by_id = auth.uid()
      OR public.is_admin()  -- 移行スクリプト用(admin が他者代理で作成)
    )
  );

CREATE POLICY activities_update ON public.activities
  FOR UPDATE
  USING (
    public.is_admin_or_manager()
    OR (
      public.current_user_role() = 'sales'
      AND created_by_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_admin_or_manager()
    OR (
      public.current_user_role() = 'sales'
      AND created_by_id = auth.uid()
    )
  );

-- ============================================================================
-- レポート関連テーブルの RLS(05_reports_schema.sql に対応)
-- 仕様書 §9.14: visibility に応じた SELECT、レポート実行結果は実行ユーザーのRLSで自然にフィルタ
-- ※ 05_reports_schema.sql 適用後にこのポリシーが適用されるよう、本ファイルは番号 02a として配置。
--   レポート用RLS は 05a_reports_rls.sql に分離する(本ファイルでは扱わない)。
-- ============================================================================

-- ============================================================================
-- 末尾コメント
-- ============================================================================
-- 物理 DELETE はすべて拒否(DELETE ポリシー未定義)。
-- 「削除」操作は UPDATE SET deleted_at = now() で行う(仕様書 §4.3 論理削除のみ)。
