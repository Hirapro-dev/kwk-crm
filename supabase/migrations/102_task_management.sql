-- ============================================================================
-- migration 102: タスク管理 (2026-09-18) / CLAUDE.md §5.20
--
-- 内容(2026-09-18 ユーザー承認済み):
--   1. task_projects(プロジェクト。visibility: public=全員 / private=メンバーのみ)/ task_project_members(非公開のメンバー)
--   2. task_sections(セクション)/ tasks(タスク・サブタスク。parent_task_id で親子。member_id で会員に紐付け)
--   3. task_comments / task_attachments(Storage 非公開バケット task-attachments)
--   4. RLS: 閲覧は can_view_task_project(公開 or メンバー or admin)。書込は viewer 以外。プロジェクトの設定は作成者と admin
--   5. メニューバーに「タスク」(/task)
--   ※ 論理削除(deleted_at)の書込みはサービスロールで行う(PostgREST の UPDATE は RETURNING 付きのため、
--     閲覧ポリシーから外れた行は RLS に拒否される。§8.1 /mail の注記)
-- ============================================================================

-- 1) プロジェクト
CREATE TABLE IF NOT EXISTS public.task_projects (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  color        text,
  description  text,
  visibility   text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  is_archived  boolean NOT NULL DEFAULT false,
  sort_order   integer NOT NULL DEFAULT 100,
  created_by   uuid REFERENCES public.users(id),
  asana_gid    text UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
COMMENT ON TABLE public.task_projects IS 'タスク管理のプロジェクト(§5.20)。visibility=private はメンバーのみ閲覧';

CREATE TABLE IF NOT EXISTS public.task_project_members (
  project_id   integer NOT NULL REFERENCES public.task_projects(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  added_by     uuid REFERENCES public.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_project_members_user ON public.task_project_members(user_id);

-- 2) セクション・タスク
CREATE TABLE IF NOT EXISTS public.task_sections (
  id           serial PRIMARY KEY,
  project_id   integer NOT NULL REFERENCES public.task_projects(id) ON DELETE CASCADE,
  name         text NOT NULL,
  sort_order   integer NOT NULL DEFAULT 100,
  asana_gid    text UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_sections_project ON public.task_sections(project_id, sort_order);

CREATE TABLE IF NOT EXISTS public.tasks (
  id                bigserial PRIMARY KEY,
  project_id        integer NOT NULL REFERENCES public.task_projects(id),
  section_id        integer REFERENCES public.task_sections(id) ON DELETE SET NULL,
  parent_task_id    bigint REFERENCES public.tasks(id),
  name              text NOT NULL,
  notes             text,
  assignee_id       uuid REFERENCES public.users(id),
  assignee_name_raw text,
  member_id         text REFERENCES public.members(id),
  start_date        date,
  due_date          date,
  completed_at      timestamptz,
  completed_by      uuid REFERENCES public.users(id),
  created_by        uuid REFERENCES public.users(id),
  sort_order        numeric(18,4) NOT NULL DEFAULT 100,
  asana_gid         text UNIQUE,
  asana_created_at  timestamptz,
  extra             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
COMMENT ON TABLE public.tasks IS 'タスク・サブタスク(§5.20)。parent_task_id で親子、member_id で会員に紐付け';
CREATE INDEX IF NOT EXISTS idx_tasks_project_section ON public.tasks(project_id, section_id, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_open ON public.tasks(assignee_id, due_date) WHERE deleted_at IS NULL AND completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_member ON public.tasks(member_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON public.tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;

-- 3) コメント・添付
CREATE TABLE IF NOT EXISTS public.task_comments (
  id               bigserial PRIMARY KEY,
  task_id          bigint NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id          uuid REFERENCES public.users(id),
  author_name_raw  text,
  body             text NOT NULL,
  asana_gid        text UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON public.task_comments(task_id, created_at);

CREATE TABLE IF NOT EXISTS public.task_attachments (
  id            bigserial PRIMARY KEY,
  task_id       bigint NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  filename      text NOT NULL,
  content_type  text,
  size_bytes    bigint,
  storage_path  text NOT NULL,
  uploaded_by   uuid REFERENCES public.users(id),
  asana_gid     text UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON public.task_attachments(task_id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('task-attachments', 'task-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- updated_at トリガー(既存の関数 set_updated_at を使う)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_task_projects_updated_at ON public.task_projects';
    EXECUTE 'CREATE TRIGGER trg_task_projects_updated_at BEFORE UPDATE ON public.task_projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_task_sections_updated_at ON public.task_sections';
    EXECUTE 'CREATE TRIGGER trg_task_sections_updated_at BEFORE UPDATE ON public.task_sections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_tasks_updated_at ON public.tasks';
    EXECUTE 'CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
    EXECUTE 'DROP TRIGGER IF EXISTS trg_task_comments_updated_at ON public.task_comments';
    EXECUTE 'CREATE TRIGGER trg_task_comments_updated_at BEFORE UPDATE ON public.task_comments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
  END IF;
END $$;

-- 4) RLS
-- 閲覧できるプロジェクトか: admin / 公開 / 自分がメンバー。呼び出し側の auth.uid() を関数内で見る
CREATE OR REPLACE FUNCTION public.can_view_task_project(p_project_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.task_projects p
         WHERE p.id = p_project_id AND p.deleted_at IS NULL AND p.visibility = 'public'
      )
      OR EXISTS (
        SELECT 1 FROM public.task_project_members m
         WHERE m.project_id = p_project_id AND m.user_id = (SELECT auth.uid())
      );
$$;

-- プロジェクトの設定を変えられるか: 作成者 or admin
CREATE OR REPLACE FUNCTION public.can_manage_task_project(p_project_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.task_projects p
         WHERE p.id = p_project_id AND p.created_by = (SELECT auth.uid())
      );
$$;

ALTER TABLE public.task_projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_sections        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_attachments     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_projects_select ON public.task_projects;
DROP POLICY IF EXISTS task_projects_insert ON public.task_projects;
DROP POLICY IF EXISTS task_projects_update ON public.task_projects;
CREATE POLICY task_projects_select ON public.task_projects
  FOR SELECT USING (deleted_at IS NULL AND (SELECT public.can_view_task_project(id)));
CREATE POLICY task_projects_insert ON public.task_projects
  FOR INSERT WITH CHECK ((SELECT public.can_write()) AND created_by = (SELECT auth.uid()));
CREATE POLICY task_projects_update ON public.task_projects
  FOR UPDATE USING ((SELECT public.can_manage_task_project(id)))
  WITH CHECK ((SELECT public.can_manage_task_project(id)));

DROP POLICY IF EXISTS task_project_members_select ON public.task_project_members;
DROP POLICY IF EXISTS task_project_members_write  ON public.task_project_members;
CREATE POLICY task_project_members_select ON public.task_project_members
  FOR SELECT USING ((SELECT public.can_view_task_project(project_id)));
CREATE POLICY task_project_members_write ON public.task_project_members
  FOR ALL USING ((SELECT public.can_manage_task_project(project_id)))
  WITH CHECK ((SELECT public.can_manage_task_project(project_id)));

DROP POLICY IF EXISTS task_sections_select ON public.task_sections;
DROP POLICY IF EXISTS task_sections_write  ON public.task_sections;
CREATE POLICY task_sections_select ON public.task_sections
  FOR SELECT USING ((SELECT public.can_view_task_project(project_id)));
CREATE POLICY task_sections_write ON public.task_sections
  FOR ALL USING ((SELECT public.can_write()) AND (SELECT public.can_view_task_project(project_id)))
  WITH CHECK ((SELECT public.can_write()) AND (SELECT public.can_view_task_project(project_id)));

DROP POLICY IF EXISTS tasks_select ON public.tasks;
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_select ON public.tasks
  FOR SELECT USING (deleted_at IS NULL AND (SELECT public.can_view_task_project(project_id)));
CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT WITH CHECK ((SELECT public.can_write()) AND (SELECT public.can_view_task_project(project_id)));
CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE USING ((SELECT public.can_write()) AND (SELECT public.can_view_task_project(project_id)))
  WITH CHECK ((SELECT public.can_write()) AND (SELECT public.can_view_task_project(project_id)));

DROP POLICY IF EXISTS task_comments_select ON public.task_comments;
DROP POLICY IF EXISTS task_comments_insert ON public.task_comments;
DROP POLICY IF EXISTS task_comments_delete ON public.task_comments;
CREATE POLICY task_comments_select ON public.task_comments
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND t.deleted_at IS NULL AND (SELECT public.can_view_task_project(t.project_id))));
CREATE POLICY task_comments_insert ON public.task_comments
  FOR INSERT WITH CHECK ((SELECT public.can_write()) AND user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND (SELECT public.can_view_task_project(t.project_id))));
CREATE POLICY task_comments_delete ON public.task_comments
  FOR DELETE USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS task_attachments_select ON public.task_attachments;
DROP POLICY IF EXISTS task_attachments_delete ON public.task_attachments;
CREATE POLICY task_attachments_select ON public.task_attachments
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND t.deleted_at IS NULL AND (SELECT public.can_view_task_project(t.project_id))));
-- 添付の登録・実体の保存はサーバー側(サービスロール)で行う(閲覧可否を確認してから)。削除は本人 or admin
CREATE POLICY task_attachments_delete ON public.task_attachments
  FOR DELETE USING (uploaded_by = (SELECT auth.uid()) OR (SELECT public.is_admin()));

-- 5) メニュー
INSERT INTO nav_items (id, label, href, match_prefix, sort_order, is_visible, parent_id, visible_roles)
VALUES ('task', 'タスク', '/task', true, 49, true, NULL, NULL)
ON CONFLICT (id) DO UPDATE
  SET label = excluded.label, href = excluded.href, match_prefix = excluded.match_prefix;
