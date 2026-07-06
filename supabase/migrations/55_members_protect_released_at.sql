-- ============================================================================
-- migration 55: プロテクト解除日時の記録 (2026-07)
--
-- 背景:
--   プロテクト解除時、cron(expire-protects)は protect_expires_at / protect_by_user_id を
--   NULL に消去するため「いつ解除されたか」が残らず、「解除されてから●日後」を算出できない。
--
-- 対応:
--   - members.protect_released_at を追加し、解除時(cron/手動)に now() を刻む。
--   - 再度プロテクトを付与したら NULL に戻す(解除状態でなくなるため)。
--   - 過去に解除済みのレコードは記録が無く空欄(今後の解除分から蓄積)。
--   - 会員項目(field_definitions)に追加し、詳細画面で「解除後経過日数」を表示可能にする。
--   - レポートでは計算カラム(schema_all の __days_since_protect_release__)で条件に使える。
-- ============================================================================

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS protect_released_at timestamptz;

COMMENT ON COLUMN public.members.protect_released_at IS
  'プロテクトが解除された日時。解除後経過日数の算出に使う。再プロテクトで NULL に戻す。';

-- 解除済み会員の抽出(レポート条件)を高速化する部分インデックス
CREATE INDEX IF NOT EXISTS idx_members_protect_released
  ON public.members(protect_released_at)
  WHERE protect_released_at IS NOT NULL AND deleted_at IS NULL;

-- プロテクト付与 RPC(migration 38)を更新: 付与時は解除マーカーをクリアする
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
    SET protect_by_user_id  = p_user_id,
        protect_expires_at  = p_expires_at,
        owner_name_raw      = p_owner_name,
        protect_released_at = NULL,       -- 再プロテクトで解除マーカーをクリア
        updated_at          = now()
    WHERE id = p_member_id AND deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_member_protect(text, uuid, timestamptz, text) TO authenticated;

-- field_definitions: 会員の詳細に表示(一覧は既定OFF)。画面側で「解除後●日」を算出表示する。
INSERT INTO public.field_definitions
  (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system,
   sort_order_list, sort_order_detail, is_in_db)
VALUES
  ('members', 'protect_released_at', 'プロテクト解除後経過', 'datetime', false, true, true, 210, 56, true)
ON CONFLICT (object_id, field_name) DO UPDATE
  SET label = EXCLUDED.label, updated_at = now();
