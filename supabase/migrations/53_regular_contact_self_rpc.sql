-- ============================================================================
-- migration 53: 定期連絡者の自己割り当て RPC (2026-07)
--
-- 背景:
--   members_update ポリシーは admin または「can_write() かつ owner_id=自分」のみ
--   UPDATE を許可する。support/sales は自分が所有しない会員を更新できないため、
--   顧客詳細から「自分を定期連絡者にする」操作が RLS に阻まれる。
--
-- 対応:
--   regular_contact_id 列のみを auth.uid() に設定/解除する SECURITY DEFINER 関数を
--   用意し、authenticated 全員に許可する(自分自身への割当のみ・列を限定するため安全)。
--   apply_member_protect (migration 38) と同方式。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.toggle_regular_contact_self(p_member_id text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  cur uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT regular_contact_id INTO cur
  FROM public.members
  WHERE id = p_member_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found';
  END IF;

  IF cur = uid THEN
    -- 既に自分が担当 → 解除
    UPDATE public.members
      SET regular_contact_id = NULL, updated_at = now()
      WHERE id = p_member_id;
    RETURN NULL;
  ELSE
    -- 未設定 or 他人 → 自分を担当に設定(引き継ぎ)
    UPDATE public.members
      SET regular_contact_id = uid, updated_at = now()
      WHERE id = p_member_id;
    RETURN uid;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_regular_contact_self(text) TO authenticated;
