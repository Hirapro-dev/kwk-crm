-- ============================================================================
-- 活動履歴 投入後のインデックス再作成
-- 配置: scripts/migrate/sql/activities_recreate_indexes.sql
-- 前提: activities_drop_indexes.sql 実行 → 移行スクリプト完了 後に実行
--
-- 仕様書 §5.7 で定義されたインデックス一式を再構築する。
-- 120万件への CREATE INDEX は数分かかる想定。
-- ※ CONCURRENTLY はトランザクション内で使えないが、本番運用中の再作成では
--   サービス停止を避けるために `CONCURRENTLY` を使う(セッションは分けて実行)。
-- ============================================================================

-- 移行直後はサービス停止前提なので通常版で OK(高速)
CREATE INDEX idx_act_member_date  ON public.activities(member_id, registered_datetime DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_act_owner_date   ON public.activities(owner_id,  registered_datetime DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_act_bunrui       ON public.activities(d_bunrui, m_bunrui, s_bunrui);
CREATE INDEX idx_act_reg_date     ON public.activities(registered_date);
CREATE INDEX idx_act_reg_datetime ON public.activities(registered_datetime DESC);

-- 統計情報を更新(クエリプランナへ反映)
ANALYZE public.activities;

-- 確認:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'activities';
-- EXPLAIN ANALYZE
--   SELECT * FROM public.activities
--   WHERE member_id = 'K-0000001'
--   ORDER BY registered_datetime DESC LIMIT 50;
