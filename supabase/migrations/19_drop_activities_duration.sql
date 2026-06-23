-- ============================================================================
-- migration 19: 対応歴(activities)から所要時間(duration_minutes)を削除 (2026-06)
--   - ダッシュボードの対応時間累計表示も廃止したため、列自体を削除
--   - 集計MV mv_monthly_activities が SUM(duration_minutes) を持つため、
--     先にMVを削除 → 列削除 → 所要時間なしでMVを再作成 する
--   - total_minutes はアプリ未使用(コメント参照のみ)のため安全に除去できる
--   - todo_time は別項目のため残す
-- ============================================================================

BEGIN;

-- 1) 依存している集計MVを一旦削除(MV上のインデックスも一緒に消える)
DROP MATERIALIZED VIEW IF EXISTS public.mv_monthly_activities;

-- 2) 所要時間カラムを削除
ALTER TABLE public.activities DROP COLUMN IF EXISTS duration_minutes;

-- 3) フィールド管理に所要時間の定義が登録されていれば併せて削除
DELETE FROM public.field_definitions
 WHERE object_id = 'activities' AND field_name = 'duration_minutes';

-- 4) 標準レポート定義から「合計時間(分)」列(source=act.duration_minutes)を除去
--    (列が消えるため、残すと実行時にエラーになる)
UPDATE public.reports
   SET definition = jsonb_set(
         definition,
         '{columns}',
         (
           SELECT COALESCE(jsonb_agg(col), '[]'::jsonb)
           FROM jsonb_array_elements(definition->'columns') AS col
           WHERE col->>'source' <> 'act.duration_minutes'
         )
       )
 WHERE definition->'columns' @> '[{"source":"act.duration_minutes"}]';

-- 5) MVを所要時間なしで作り直す(件数・ユニーク会員数は維持)
CREATE MATERIALIZED VIEW public.mv_monthly_activities AS
SELECT
  owner_id,
  date_trunc('month', registered_datetime)::date          AS month,
  d_bunrui,
  m_bunrui,
  COUNT(*)                                                AS activity_count,
  COUNT(DISTINCT member_id)                               AS unique_member_count
FROM public.activities
WHERE deleted_at IS NULL
  AND registered_datetime IS NOT NULL
GROUP BY owner_id, date_trunc('month', registered_datetime), d_bunrui, m_bunrui;

CREATE UNIQUE INDEX idx_mv_mact_unique ON public.mv_monthly_activities(owner_id, month, d_bunrui, m_bunrui);
CREATE INDEX idx_mv_mact_month         ON public.mv_monthly_activities(month);
CREATE INDEX idx_mv_mact_owner         ON public.mv_monthly_activities(owner_id);

COMMIT;
