-- ============================================================================
-- レポート機能用スキーマ
-- ターゲット: Supabase Postgres (PostgreSQL 15+)
-- 配置: supabase/migrations/05_reports_schema.sql
-- 前提: 01_schema.sql が適用済みであること
-- ============================================================================

-- ============================================================================
-- report_folders (レポートフォルダ)
-- ============================================================================
CREATE TABLE public.report_folders (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          text NOT NULL,
  parent_id     uuid REFERENCES public.report_folders(id) ON DELETE CASCADE,
  visibility    text NOT NULL DEFAULT 'team' CHECK (visibility IN ('private','team','public')),
  created_by    uuid NOT NULL REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX idx_report_folders_parent  ON public.report_folders(parent_id);
CREATE INDEX idx_report_folders_creator ON public.report_folders(created_by);

CREATE TRIGGER trg_report_folders_updated_at
  BEFORE UPDATE ON public.report_folders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- reports (レポート定義)
-- ============================================================================
CREATE TABLE public.reports (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  text NOT NULL,
  description           text,
  report_type           text NOT NULL,                  -- "RT01" .. "RT10" / "custom"
  folder_id             uuid REFERENCES public.report_folders(id),
  definition            jsonb NOT NULL DEFAULT '{}'::jsonb,
  visibility            text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','team','public')),
  favorited_by          uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  is_standard           boolean NOT NULL DEFAULT false, -- 標準レポート(編集禁止)フラグ
  created_by            uuid NOT NULL REFERENCES public.users(id),
  last_run_at           timestamptz,
  last_run_duration_ms  int,
  last_run_row_count    int,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

CREATE INDEX idx_reports_folder         ON public.reports(folder_id);
CREATE INDEX idx_reports_creator        ON public.reports(created_by);
CREATE INDEX idx_reports_type           ON public.reports(report_type);
CREATE INDEX idx_reports_favorited_gin  ON public.reports USING gin(favorited_by);
CREATE INDEX idx_reports_definition_gin ON public.reports USING gin(definition);

CREATE TRIGGER trg_reports_updated_at
  BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- report_runs (実行履歴) ※Phase 2 で結果キャッシュとしても利用可能
-- ============================================================================
CREATE TABLE public.report_runs (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id      uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  executed_by    uuid NOT NULL REFERENCES public.users(id),
  executed_at    timestamptz NOT NULL DEFAULT now(),
  duration_ms    int,
  row_count      int,
  status         text NOT NULL DEFAULT 'success' CHECK (status IN ('success','timeout','error')),
  error_message  text,
  result_cache   jsonb                                   -- 結果キャッシュ(Phase 2)
);

CREATE INDEX idx_report_runs_report ON public.report_runs(report_id, executed_at DESC);
CREATE INDEX idx_report_runs_user   ON public.report_runs(executed_by, executed_at DESC);

-- ============================================================================
-- report_subscriptions (定期実行) ※Phase 2
-- ============================================================================
CREATE TABLE public.report_subscriptions (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id         uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES public.users(id),
  schedule          text NOT NULL,                      -- cron 形式 "0 9 * * 1"
  output_format     text NOT NULL CHECK (output_format IN ('csv','xlsx','email_summary')),
  email_recipients  text[],
  enabled           boolean NOT NULL DEFAULT true,
  last_executed_at  timestamptz,
  next_run_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_subs_report  ON public.report_subscriptions(report_id);
CREATE INDEX idx_report_subs_user    ON public.report_subscriptions(user_id);
CREATE INDEX idx_report_subs_next    ON public.report_subscriptions(next_run_at) WHERE enabled = true;

CREATE TRIGGER trg_report_subs_updated_at
  BEFORE UPDATE ON public.report_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 集計用マテリアライズドビュー (活動の月次集計)
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_monthly_activities AS
SELECT
  owner_id,
  date_trunc('month', registered_datetime)::date          AS month,
  d_bunrui,
  m_bunrui,
  COUNT(*)                                                AS activity_count,
  COALESCE(SUM(duration_minutes), 0)                      AS total_minutes,
  COUNT(DISTINCT member_id)                               AS unique_member_count
FROM public.activities
WHERE deleted_at IS NULL
  AND registered_datetime IS NOT NULL
GROUP BY owner_id, date_trunc('month', registered_datetime), d_bunrui, m_bunrui;

CREATE UNIQUE INDEX idx_mv_mact_unique ON public.mv_monthly_activities(owner_id, month, d_bunrui, m_bunrui);
CREATE INDEX idx_mv_mact_month         ON public.mv_monthly_activities(month);
CREATE INDEX idx_mv_mact_owner         ON public.mv_monthly_activities(owner_id);

-- 更新は pg_cron で日次 (例: 毎日3時)
-- SELECT cron.schedule('refresh_mv_monthly_activities', '0 3 * * *',
--   $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_monthly_activities$$);

-- ============================================================================
-- 末尾コメント
-- ============================================================================
-- 次のmigration: 06_seed_standard_reports.sql (標準レポート10件をINSERT)
