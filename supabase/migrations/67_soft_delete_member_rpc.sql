-- ============================================================================
-- migration 67: 会員(members)の論理削除を SECURITY DEFINER RPC で確実に行う (2026-07)
--
-- 背景:
--   対応歴(activities)と全く同じ事象が会員でも発生。
--   members_update の WITH CHECK は権限のみ(deleted_at 条件なし)だが、
--   本番環境では deleted_at をセットする UPDATE が RLS で拒否される
--   ("new row violates row-level security policy for table members")。
--   通常フィールドの編集は通るため RLS 評価の想定外挙動。
--
-- 対応:
--   migration 58(soft_delete_activity)と同じ SECURITY DEFINER 方式で、
--   関数内で管理者チェックを行い、RLS に依存せず論理削除する。
--   - auth.uid() が admin であることを確認(人の操作のみ)。
--   - AFTER UPDATE の監査トリガー(migration 41)は関数内 UPDATE でも発火し、
--     auth.uid()(=実行した管理者)を actor として記録する。
--   - members の PK は text(K-XXXXXXX)のため引数は text。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_member(p_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  UPDATE public.members
     SET deleted_at = now(),
         updated_at = now()
   WHERE id = p_id
     AND deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.soft_delete_member(text) TO authenticated;
