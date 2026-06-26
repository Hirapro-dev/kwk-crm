-- ============================================================================
-- 全ロールで動作させる SECURITY DEFINER 関数 (2026-06)
--
-- 背景:
--   - reports.favorited_by の更新は reports_update(作成者/admin)に阻まれ、
--     sales 等は他人作成/標準レポートをお気に入りに登録できない。
--   - members のプロテクト列の更新は members_update(admin/owner)に阻まれ、
--     sales 等は自分担当でない会員にプロテクトを付けられない。
--
-- 対応:
--   - 該当列のみを更新する SECURITY DEFINER 関数を用意し、authenticated 全員に許可。
--   - 関数内で更新対象列を限定するため、行全体の編集権限は広げない(安全)。
-- ============================================================================

-- 1) レポートお気に入りトグル(全ロール)
CREATE OR REPLACE FUNCTION public.toggle_report_favorite(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  arr uuid[];
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT favorited_by INTO arr
  FROM public.reports
  WHERE id = p_report_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found';
  END IF;

  IF arr @> ARRAY[uid] THEN
    UPDATE public.reports
      SET favorited_by = array_remove(favorited_by, uid)
      WHERE id = p_report_id;
  ELSE
    UPDATE public.reports
      SET favorited_by = array_append(COALESCE(favorited_by, ARRAY[]::uuid[]), uid)
      WHERE id = p_report_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_report_favorite(uuid) TO authenticated;

-- 2) 会員プロテクト設定(全ロール)
--    通電/接触対応の活動作成時に、対応者を会員のプロテクト担当として設定する。
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
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
