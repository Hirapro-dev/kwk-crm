-- ============================================================================
-- migration 132: 広告マスタの選んだ記録(「最近選んだ広告」用) (2026-10-27)
--                CLAUDE.md §5.18
--
-- 目的:
--   広告マスタの【取得】ダイアログで、直近 1 か月に(全員の誰かが)選んだ広告を
--   「最近選んだ広告」として上にまとめて出す。そのために「誰が・いつ・どの広告を選んだか」を
--   1 回 1 行で残す。会員・問合せの広告ID からは推測しない(会員の新規作成は監査ログに値が残らず、
--   問合せは監査ログの対象外のため)。
--
-- 方針:
--   - 追記のみ(更新・削除のポリシーは作らない)。古い行は残るが 1 回 1 行で小さい。
--   - RLS: SELECT は全ロール(全員分を「最近」に使う)。INSERT は admin / manager / sales / support が自分の行だけ。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ad_master_picks (
  id         bigserial PRIMARY KEY,
  ad_id      text NOT NULL REFERENCES public.ad_masters(id),
  picked_by  uuid NOT NULL REFERENCES public.users(id) DEFAULT auth.uid(),
  picked_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ad_master_picks IS
  '広告マスタの【取得】で広告を選んだ記録(最近選んだ広告の表示用)。CLAUDE.md §5.18';

-- 直近 1 か月分を新しい順に引く
CREATE INDEX IF NOT EXISTS idx_ad_master_picks_picked_at
  ON public.ad_master_picks(picked_at DESC);

ALTER TABLE public.ad_master_picks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ad_master_picks_select ON public.ad_master_picks;
DROP POLICY IF EXISTS ad_master_picks_insert ON public.ad_master_picks;
CREATE POLICY ad_master_picks_select ON public.ad_master_picks
  FOR SELECT TO authenticated USING (true);
CREATE POLICY ad_master_picks_insert ON public.ad_master_picks
  FOR INSERT TO authenticated
  -- 書けるロールは明示する(viewer や将来の新ロールを「<> 'viewer'」で通さない)
  WITH CHECK (
    picked_by = (SELECT auth.uid())
    AND (SELECT public.current_user_role()) IN ('admin', 'manager', 'sales', 'support')
  );
