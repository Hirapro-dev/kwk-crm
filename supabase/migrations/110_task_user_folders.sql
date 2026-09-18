-- ============================================================================
-- migration 110: タスク管理のマイフォルダ(ユーザーごとのプロジェクトフォルダ) (2026-09-18) / CLAUDE.md §5.20
--
-- 背景:
--   Asana から取り込んだプロジェクトが 58 件あり、左メニューの「参加プロジェクト」が長い。
--   メーラーのマイフォルダ(migration 92)と同じく、各ユーザーが名前を付けたフォルダを作り、
--   プロジェクトをドラッグ&ドロップで入れて整理できるようにする。
--
-- 方針(migration 92 と同じ):
--   - 端末に依らず同じ整理を出すため DB に持つ。ユーザーごと(共有しない)。
--   - task_user_folders: フォルダ(名前・並び)。task_user_folder_items: フォルダ内のプロジェクト(並び付き)。
--     1つのプロジェクトを複数のフォルダに入れてもよい(主キーは (folder_id, project_id))。
--   - items にも user_id を持たせ、RLS を結合なしで書けるようにする(親フォルダと同じ持ち主)。
--   - RLS: 自分の行だけ読み書き(管理者も他人のフォルダは触らない)。
--   - フォルダ・プロジェクト・ユーザーが消えたら行も消す(ON DELETE CASCADE)。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.task_user_folders (
  id          serial PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  sort_order  integer     NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.task_user_folders IS
  'タスク管理のマイフォルダ(ユーザーごとのプロジェクトフォルダ)。左メニューの「マイフォルダ」区画。CLAUDE.md §5.20';
CREATE INDEX IF NOT EXISTS idx_task_user_folders_user
  ON public.task_user_folders(user_id, sort_order, id);
DROP TRIGGER IF EXISTS trg_task_user_folders_updated_at ON public.task_user_folders;
CREATE TRIGGER trg_task_user_folders_updated_at
  BEFORE UPDATE ON public.task_user_folders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS public.task_user_folder_items (
  folder_id   integer     NOT NULL REFERENCES public.task_user_folders(id) ON DELETE CASCADE,
  project_id  integer     NOT NULL REFERENCES public.task_projects(id)     ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES public.users(id)             ON DELETE CASCADE,
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (folder_id, project_id)
);
COMMENT ON TABLE public.task_user_folder_items IS
  'マイフォルダ内のプロジェクト(並び付き)。CLAUDE.md §5.20';

ALTER TABLE public.task_user_folders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_user_folder_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_user_folders_own ON public.task_user_folders;
CREATE POLICY task_user_folders_own ON public.task_user_folders
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS task_user_folder_items_own ON public.task_user_folder_items;
CREATE POLICY task_user_folder_items_own ON public.task_user_folder_items
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
