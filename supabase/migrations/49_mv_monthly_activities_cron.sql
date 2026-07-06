-- ============================================================================
-- 集計MV mv_monthly_activities の日次自動リフレッシュを pg_cron で設定 (2026-07)
-- CLAUDE.md §9.13(レポート機能のパフォーマンス対策)
--
-- 背景:
--   - mv_monthly_activities(担当×月×大/小分類の対応歴集計)は
--     migration 05 で作成、migration 19 で所要時間なしに再作成済み。
--   - しかし更新用の pg_cron スケジュールは 05 でコメントアウトのままで、
--     一度も登録されていなかった。=> MV は作成時点のスナップショットのまま
--     古くなり続ける「宙に浮いたビュー」状態だった。
--   - 本 migration で pg_cron を有効化し、日次リフレッシュを登録して
--     「毎日自動で最新化される」状態にする。
--
-- 方針:
--   - REFRESH ... CONCURRENTLY は一意インデックス idx_mv_mact_unique を前提とする
--     (migration 19 で作成済み)。CONCURRENTLY によりリフレッシュ中も参照をブロックしない。
--   - pg_cron はサーバ時刻(UTC)でスケジュールされる。日本時間 03:00(深夜・低負荷帯)に
--     実行するため、UTC では 18:00 を指定する(18:00 UTC = 翌 03:00 JST)。
--   - 何度流しても安全になるよう、同名ジョブが既にあれば一旦解除してから登録する。
--
-- 【要確認】pg_cron 拡張の有効化:
--   Supabase では通常この CREATE EXTENSION はマイグレーション適用ロールで成功するが、
--   プロジェクトの権限設定によっては SQL からの拡張有効化が拒否される場合がある。
--   その場合は Supabase ダッシュボード(Database > Extensions)で pg_cron を有効化した後、
--   本ファイルの CREATE EXTENSION 行以降(スケジュール登録部)のみを再実行すること。
-- ============================================================================

-- 1) pg_cron 拡張を有効化(既に有効なら何もしない)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2) 同名ジョブが既に登録済みなら一旦解除(冪等性の担保)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh_mv_monthly_activities') THEN
    PERFORM cron.unschedule('refresh_mv_monthly_activities');
  END IF;
END $$;

-- 3) 毎日 18:00 UTC(= 日本時間 翌 03:00)に MV を再集計
SELECT cron.schedule(
  'refresh_mv_monthly_activities',
  '0 18 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_monthly_activities$$
);

-- 4) 登録直後に一度だけ手動リフレッシュしておく(既存の古いスナップショットを最新化)
--    ここは CONCURRENTLY を付けない(初回・単発のため通常リフレッシュで十分)。
REFRESH MATERIALIZED VIEW public.mv_monthly_activities;

-- ============================================================================
-- 確認用(手動実行):
--   -- 登録されたジョブの確認
--   SELECT jobid, schedule, command, active FROM cron.job
--    WHERE jobname = 'refresh_mv_monthly_activities';
--   -- 直近の実行履歴の確認
--   SELECT status, return_message, start_time, end_time
--     FROM cron.job_run_details
--    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'refresh_mv_monthly_activities')
--    ORDER BY start_time DESC LIMIT 5;
-- ============================================================================
