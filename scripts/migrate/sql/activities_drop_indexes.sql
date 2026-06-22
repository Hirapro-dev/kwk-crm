-- ============================================================================
-- 活動履歴 120万件投入の高速化用: インデックス一時 DROP
-- 仕様書 §6.1 Phase 3
-- 配置: scripts/migrate/sql/activities_drop_indexes.sql
--
-- 使い方:
--   1. このSQLを Supabase Studio の SQL Editor で実行
--   2. pnpm migrate:activities を流す
--   3. activities_recreate_indexes.sql を実行して索引を戻す
--
-- ※ PK と UNIQUE 制約は残す(legacy_sf_id の UPSERT に必要)。
-- ※ RLS ポリシーは性能に影響しないため触らない。
-- ============================================================================

DROP INDEX IF EXISTS public.idx_act_member_date;
DROP INDEX IF EXISTS public.idx_act_owner_date;
DROP INDEX IF EXISTS public.idx_act_bunrui;
DROP INDEX IF EXISTS public.idx_act_reg_date;
DROP INDEX IF EXISTS public.idx_act_reg_datetime;

-- 確認:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'activities';
