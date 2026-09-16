-- ============================================================================
-- migration 92: マイフォルダ(ユーザーごとの受信箱フォルダ) (2026-09-16) / CLAUDE.md §5.15
--
-- 背景:
--   受信箱が数百件あり、担当者ごとに「よく確認するアドレス」を対応(案件・業務)ごとに
--   整理したい。ピン留め(migration 84)は1区画だけなので、名前を付けたフォルダを複数持てるようにし、
--   左フォルダで受信箱をドラッグ&ドロップして入れ替えられるようにする。
--
-- 方針:
--   - 端末に依らず同じ整理を出すため DB に持つ。ユーザーごと(共有しない)。
--   - mail_user_folders: フォルダ(名前・並び)。mail_user_folder_items: フォルダ内の受信箱(並び付き)。
--     1つの受信箱を複数のフォルダに入れてもよい(主キーは (folder_id, mail_box_id))。
--   - items にも user_id を持たせ、RLS を結合なしで書けるようにする(親フォルダと同じ持ち主)。
--   - RLS: 自分の行だけ読み書き(管理者も他人のフォルダは触らない)。
--   - フォルダ・受信箱・ユーザーが消えたら行も消す(ON DELETE CASCADE)。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mail_user_folders (
  id          serial PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  sort_order  integer     NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mail_user_folders IS
  'マイフォルダ(ユーザーごとの受信箱フォルダ)。左フォルダの「マイフォルダ」区画。CLAUDE.md §5.15';

CREATE INDEX IF NOT EXISTS idx_mail_user_folders_user
  ON public.mail_user_folders(user_id, sort_order, id);

DROP TRIGGER IF EXISTS trg_mail_user_folders_updated_at ON public.mail_user_folders;
CREATE TRIGGER trg_mail_user_folders_updated_at
  BEFORE UPDATE ON public.mail_user_folders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS public.mail_user_folder_items (
  folder_id   integer     NOT NULL REFERENCES public.mail_user_folders(id) ON DELETE CASCADE,
  mail_box_id integer     NOT NULL REFERENCES public.mail_boxes(id)        ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES public.users(id)             ON DELETE CASCADE,
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (folder_id, mail_box_id)
);

COMMENT ON TABLE public.mail_user_folder_items IS
  'マイフォルダ内の受信箱(並び付き)。CLAUDE.md §5.15';

ALTER TABLE public.mail_user_folders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_user_folder_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mail_user_folders_own ON public.mail_user_folders;
CREATE POLICY mail_user_folders_own ON public.mail_user_folders
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS mail_user_folder_items_own ON public.mail_user_folder_items;
CREATE POLICY mail_user_folder_items_own ON public.mail_user_folder_items
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
