-- ============================================================================
-- 新規会員の protect_by_user_id を「free」ユーザーに自動設定 (2026-06)
--
-- 背景: 定期取込などで新規作成された会員は protect_by_user_id が未設定(null)となり、
--       一覧で「free」がグレー表示(=未プロテクト)になっていた。
--       既存の大多数は「free」ユーザー(hirapro777@gmail.com)にプロテクト済みのため、
--       新規行も同ユーザーを自動で紐づけて表示を統一する。
--
-- 方式: BEFORE INSERT トリガーで protect_by_user_id が null の行に free ユーザーをセット。
--       既存行の再取込(ON CONFLICT DO UPDATE)には影響しない(INSERT時のみ発火)。
-- ============================================================================

-- free ユーザー: d6ab8478-da1e-491c-b76c-c58147c3b056 (full_name='free', hirapro777@gmail.com)

CREATE OR REPLACE FUNCTION public.default_member_protect()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.protect_by_user_id IS NULL THEN
    NEW.protect_by_user_id := 'd6ab8478-da1e-491c-b76c-c58147c3b056';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_default_member_protect ON public.members;
CREATE TRIGGER trg_default_member_protect
  BEFORE INSERT ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.default_member_protect();

-- 既存のグレー(protect未設定)会員を free ユーザーへ紐づけ(表示統一)
UPDATE public.members
   SET protect_by_user_id = 'd6ab8478-da1e-491c-b76c-c58147c3b056'
 WHERE protect_by_user_id IS NULL
   AND deleted_at IS NULL;
