-- ============================================================================
-- Row Level Security ポリシー
-- 仕様書 §7.2 に基づく実装
-- 配置: supabase/migrations/02_rls_policies.sql
-- 前提: 01_schema.sql 適用済み
-- ============================================================================
-- ※本ファイルは Phase 1 で本実装する。Phase 0 ではスケルトンのみ。

-- ============================================================================
-- 現在のユーザーの role を返すヘルパ関数
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid() AND deleted_at IS NULL;
$$;

-- ============================================================================
-- RLS 有効化(全テーブル)
-- ============================================================================
ALTER TABLE public.users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forms         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inquiries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities    ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Phase 1 で実装予定のポリシー (現時点ではプレースホルダ)
--   仕様書 §7.2 参照
--
--   - members: sales は owner_id = auth.uid() OR owner_id IS NULL のみ
--   - activities: sales は自分担当会員の活動のみ SELECT
--   - applications: 同上
--   - inquiries: 全 sales が SELECT 可
--   - admin / manager / viewer は専用ポリシーで全件閲覧
-- ============================================================================

-- TODO(Phase 1): 各テーブルの CREATE POLICY 文を追加する
