-- ============================================================================
-- サマリお気に入り (summary_favorites)  ★Phase 3 (2026-06)
-- CLAUDE.md §5.11
--
-- サマリ画面(フォーム集計など)の表示条件をお気に入りとして保存し、
-- サマリページ上部のダイアログからワンクリックで再表示できるようにする。
--   - config: 復元用の URL クエリ(キー→値)を jsonb で保持
--   - visibility: 'private'(自分のみ) / 'public'(全員)
-- 前提: 02a_rls_policies.sql のヘルパ関数(is_admin)定義済み
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.summary_favorites (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         text NOT NULL,
  summary_type text NOT NULL DEFAULT 'forms',          -- forms / customers / payment
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,      -- 復元用クエリ(キー→値)
  visibility   text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  created_by   uuid REFERENCES public.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_summary_fav_visibility
  ON public.summary_favorites(visibility) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_summary_fav_creator
  ON public.summary_favorites(created_by) WHERE deleted_at IS NULL;

ALTER TABLE public.summary_favorites ENABLE ROW LEVEL SECURITY;

-- SELECT: public は全員、private は作成者のみ(adminは全件)
DROP POLICY IF EXISTS summary_fav_select ON public.summary_favorites;
CREATE POLICY summary_fav_select ON public.summary_favorites
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (visibility = 'public' OR created_by = auth.uid() OR public.is_admin())
  );

-- INSERT: 本人として作成
DROP POLICY IF EXISTS summary_fav_insert ON public.summary_favorites;
CREATE POLICY summary_fav_insert ON public.summary_favorites
  FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- UPDATE/DELETE: 作成者 or admin
DROP POLICY IF EXISTS summary_fav_update ON public.summary_favorites;
CREATE POLICY summary_fav_update ON public.summary_favorites
  FOR UPDATE
  USING (created_by = auth.uid() OR public.is_admin())
  WITH CHECK (created_by = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS summary_fav_delete ON public.summary_favorites;
CREATE POLICY summary_fav_delete ON public.summary_favorites
  FOR DELETE
  USING (created_by = auth.uid() OR public.is_admin());
