-- ============================================================================
-- プロテクト適用時に owner_name_raw(永久担当) を上書きしないよう修正 (2026-07)
--
-- 背景:
--   migration 30/31 で「永久担当(owner_name_raw)」と「プロテクト(protect_by_user_id)」を
--   別概念に分離した。しかし apply_member_protect は旧仕様のまま owner_name_raw を
--   プロテクト担当者名で上書きし続けていたため、通電プロテクトのたびに
--   本来 free のままであるべき永久担当が担当者名で埋まってしまっていた。
--
-- 修正:
--   apply_member_protect が更新するのは protect_by_user_id / protect_expires_at のみとし、
--   owner_name_raw には一切触れない(永久担当はプロテクトと独立)。
--   引数 p_owner_name はシグネチャ互換のため残すが未使用(呼び出し側の変更不要)。
--
-- ※ 過去に上書きされた既存データの復旧は別途スクリプトで実施済み。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apply_member_protect(
  p_member_id  text,
  p_user_id    uuid,
  p_expires_at timestamptz,
  p_owner_name text  -- 互換のため保持(未使用)。永久担当はプロテクトで更新しない。
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

  -- owner_name_raw(永久担当) は更新しない(プロテクトと独立)。それ以外は migration 48 と同一。
  UPDATE public.members
    SET protect_by_user_id = p_user_id,
        protect_expires_at = p_expires_at,
        updated_at         = now()
    WHERE id = p_member_id AND deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_member_protect(text, uuid, timestamptz, text) TO authenticated;
