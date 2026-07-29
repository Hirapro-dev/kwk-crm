-- ============================================================================
-- migration 71: 会員「備考」の全ロール更新 RPC (2026-07)
--
-- 背景:
--   members_update ポリシーは admin または「can_write() かつ owner_id=自分」のみ
--   UPDATE を許可する。備考 (remarks, migration 70) は全ロールが会員詳細から
--   編集できるようにしたい。
--
-- 対応:
--   remarks 列のみを更新する SECURITY DEFINER 関数を用意し、authenticated 全員に
--   許可する (列を限定するため安全)。toggle_regular_contact_self (migration 53)
--   と同方式。auth.uid() が立つため audit_logs トリガーにも実行者付きで記録される。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_member_remarks(p_member_id text, p_remarks text)
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
    SET remarks = CASE WHEN btrim(coalesce(p_remarks, '')) = '' THEN NULL ELSE p_remarks END,
        updated_at = now()
    WHERE id = p_member_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_member_remarks(text, text) TO authenticated;
