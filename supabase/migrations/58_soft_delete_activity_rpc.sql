-- ============================================================================
-- migration 58: 対応歴の論理削除を SECURITY DEFINER RPC で確実に行う (2026-07)
--
-- 背景:
--   migration 57 で activities_update の WITH CHECK から deleted_at 条件を外したが、
--   本番環境では依然 deleted_at をセットする UPDATE が RLS で拒否される
--   ("new row violates row-level security policy") 事象が残った。
--   通常フィールドの編集は通るため RLS 評価の想定外挙動。
--
-- 対応:
--   apply_member_protect(migration 38/55)と同じ SECURITY DEFINER 方式で、
--   関数内で管理者チェックを行い、RLS に依存せず論理削除する。
--   - auth.uid() が admin であることを確認(人の操作のみ)。
--   - AFTER UPDATE の監査トリガー(migration 41)は関数内 UPDATE でも発火し、
--     auth.uid()(=実行した管理者)を actor として記録する。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.soft_delete_activity(p_id bigint)
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

  UPDATE public.activities
     SET deleted_at = now(),
         updated_at = now()
   WHERE id = p_id
     AND deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.soft_delete_activity(bigint) TO authenticated;
