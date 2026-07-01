-- ============================================================================
-- プロテクト適用ルール: 無効アカウント保持のプロテクトは上書き可能に (2026-07)
--
-- 要件(継続):
--   - 本人が保持 → 期限更新
--   - 別の「有効」ユーザーがアクティブに保持 → free に戻るまで上書きしない
--   - 別の「無効」ユーザー(退職者等)が保持 → 上書き可(有効ユーザーが取得できる)
--   - free / 期限切れ → 上書き
--
-- migration 43 では保持者の有効/無効を見ていなかったため、無効保持者でも
-- 上書きがブロックされていた。保持者が無効なら上書きを許可する。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_member_protect(
  p_member_id  text,
  p_user_id    uuid,
  p_expires_at timestamptz,
  p_owner_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur_user   uuid;
  cur_exp    timestamptz;
  cur_active boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT protect_by_user_id, protect_expires_at
    INTO cur_user, cur_exp
    FROM public.members
    WHERE id = p_member_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 現在の保持者が「有効」ユーザーかどうか
  SELECT is_active INTO cur_active FROM public.users WHERE id = cur_user;

  -- アクティブにプロテクト中(期限内)の場合
  IF cur_exp IS NOT NULL AND cur_exp > now() THEN
    -- 別ユーザー かつ その保持者が「有効」ユーザーの場合のみ上書きしない。
    -- 保持者が無効(退職者等)なら上書きを許可する。
    IF cur_user IS DISTINCT FROM p_user_id AND COALESCE(cur_active, false) = true THEN
      RETURN;
    END IF;
  END IF;

  UPDATE public.members
    SET protect_by_user_id = p_user_id,
        protect_expires_at = p_expires_at,
        owner_name_raw     = p_owner_name,
        updated_at         = now()
    WHERE id = p_member_id AND deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_member_protect(text, uuid, timestamptz, text) TO authenticated;
