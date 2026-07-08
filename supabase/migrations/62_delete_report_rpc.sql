-- ============================================================================
-- delete_report: レポートの論理削除を行う SECURITY DEFINER 関数 (2026-07)
--
-- 背景:
--   一覧の削除ボタンは reports を直接 UPDATE(deleted_at) していたが、
--   reports_update ポリシー(migration 54)の WITH CHECK に
--     ... AND (visibility <> 'restricted' OR public.is_admin())
--   が含まれるため、非管理者が自分の restricted レポートを論理削除しようとすると
--   「new row violates row-level security policy for table "reports"」で失敗する。
--   (migration 38 の favorited_by 更新と同種の問題)
--
-- 対応:
--   - 論理削除だけを行う SECURITY DEFINER 関数を用意し、authenticated 全員に許可。
--   - 関数内で「作成者 or admin」「標準レポートは admin のみ」を検証してから
--     deleted_at を立てる(RLS を迂回するが権限は関数内で厳格にチェック)。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_report(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  r_created_by uuid;
  r_is_standard boolean;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  SELECT created_by, is_standard INTO r_created_by, r_is_standard
  FROM public.reports
  WHERE id = p_report_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'report not found';
  END IF;

  -- 標準レポートは admin のみ削除可
  IF r_is_standard AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'standard report requires admin';
  END IF;

  -- 作成者 or admin のみ削除可
  IF r_created_by <> uid AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.reports
    SET deleted_at = now()
    WHERE id = p_report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_report(uuid) TO authenticated;
