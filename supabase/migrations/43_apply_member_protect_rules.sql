-- ============================================================================
-- プロテクト適用ルールの条件分岐 (2026-06)
--
-- 要件:
--   1. 本人がプロテクト中の会員に再度プロテクト対応歴を残したら → 期限(日数)を更新(延長)
--   2. 別ユーザーがアクティブにプロテクト中の会員は、プロテクトが free に戻る(期限切れ/解除)まで
--      上書きしない
--   3. free(未プロテクト/期限切れ/free ユーザー=expires_at null)の会員は → 対応者で新規プロテクト
--
-- 判定: 「アクティブにプロテクト中」= protect_expires_at IS NOT NULL AND protect_expires_at > now()
--   - free ユーザー(d6ab8478…)に紐づく会員は expires_at が null のため非アクティブ=上書き可。
--   - 期限切れも非アクティブ=上書き可。
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
  cur_user uuid;
  cur_exp  timestamptz;
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

  -- アクティブにプロテクト中(期限内)の場合
  IF cur_exp IS NOT NULL AND cur_exp > now() THEN
    -- 別ユーザーがプロテクト中 → free に戻るまで上書きしない
    IF cur_user IS DISTINCT FROM p_user_id THEN
      RETURN;
    END IF;
    -- 本人 → 下の UPDATE で期限を更新(延長)する
  END IF;

  -- free / 期限切れ / 本人による更新 → プロテクトを(再)設定
  UPDATE public.members
    SET protect_by_user_id = p_user_id,
        protect_expires_at = p_expires_at,
        owner_name_raw     = p_owner_name,
        updated_at         = now()
    WHERE id = p_member_id AND deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_member_protect(text, uuid, timestamptz, text) TO authenticated;
