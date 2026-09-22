-- ============================================================================
-- migration 114: ユーザーのプロフィール画像(アイコン) (2026-09-22) / CLAUDE.md §5.1 / §8.1
--
-- 目的:
--   Google アカウントのように各ユーザーが自分のアイコンを設定でき、タスク管理でアイコン + 名前
--   (スマホではアイコンだけ)を表示する。
--
-- 方針:
--   - users.avatar_path text: Storage バケット user-avatars 内のオブジェクトキー(NULL = 未設定 → 頭文字の丸)。
--   - バケット user-avatars は公開(public)。アイコンは一覧の多数の行に出すため、署名 URL ではなく
--     公開 URL(/storage/v1/object/public/user-avatars/<path>)で描画する。キーは <userId>/<時刻>.<ext> で推測しにくい。
--     画像は自分のアイコンとして本人が選んだものだけ(会員などの個人情報は入れない)。
--   - 書込み(アップロード・削除・users.avatar_path の更新)は Server Action がサービスロールで行う
--     (本人の行だけ。users の RLS は変えない)。
-- ============================================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_path text;
COMMENT ON COLUMN public.users.avatar_path IS 'プロフィール画像(Storage user-avatars のキー)。NULL は未設定。migration 114';

INSERT INTO storage.buckets (id, name, public)
VALUES ('user-avatars', 'user-avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;
