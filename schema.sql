-- ============================================================================
-- 擬似Salesforce (KAWARA版CRM) 初期スキーマ
-- ターゲット: Supabase Postgres (PostgreSQL 15+)
-- 配置: supabase/migrations/01_schema.sql
-- ============================================================================

-- 拡張機能
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- 共通: updated_at 自動更新トリガー関数
-- ============================================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 1. users (従業員)
-- ============================================================================
CREATE TABLE public.users (
  id            uuid PRIMARY KEY,                    -- auth.users.id と一致
  legacy_sf_id  text UNIQUE,
  email         text UNIQUE NOT NULL,
  first_name    text,
  last_name     text,
  full_name     text,
  is_active     boolean NOT NULL DEFAULT true,
  role          text NOT NULL CHECK (role IN ('admin','manager','sales','viewer')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX idx_users_full_name ON public.users(full_name);
CREATE INDEX idx_users_role      ON public.users(role) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 2. forms (フォームマスタ)
-- ============================================================================
CREATE TABLE public.forms (
  id            serial PRIMARY KEY,
  name          text UNIQUE NOT NULL,
  category      text,
  description   text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_forms_category ON public.forms(category);

CREATE TRIGGER trg_forms_updated_at
  BEFORE UPDATE ON public.forms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 3. projects (案件マスタ)
-- ============================================================================
CREATE TABLE public.projects (
  id            serial PRIMARY KEY,
  name          text UNIQUE NOT NULL,
  description   text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- 2026-05 更新: category カラムは廃止 (migration 08_drop_projects_category.sql)

CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 4. members (会員)  ※既存ID "K-XXXXXXX" を text PK で温存
-- ============================================================================
CREATE TABLE public.members (
  id                      text PRIMARY KEY,            -- "K-0000xxxxx"
  name                    text NOT NULL,
  name_kana               text,
  real_name               text,                        -- 実質名義人
  email1                  text,
  email2                  text,
  email3                  text,
  phone1                  text,
  do_not_call             boolean NOT NULL DEFAULT false,
  address                 text,
  postal_code             text,
  customer_type           text,                        -- 細客 等
  owner_id                uuid REFERENCES public.users(id),
  owner_name_raw          text,                        -- "Free" / "守田 和之" 等の元表記
  first_contact_date      date,
  registered_at           timestamptz,
  mailmag_registered_at   timestamptz,
  ad_id                   text,
  ad_medium               text,
  info_acquired_points    text,
  info_acquired_date      date,
  gender                  text,
  birthdate               date,
  referrer_name           text,
  affiliate_id            text,
  affiliate_name          text,
  total_amount            numeric(18,2),
  total_paid_amount       numeric(18,2),
  total_used_amount       numeric(18,2),
  extra                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz
);

CREATE INDEX idx_members_owner          ON public.members(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_members_name           ON public.members(name);
CREATE INDEX idx_members_name_kana      ON public.members(name_kana);
CREATE INDEX idx_members_email1         ON public.members(email1);
CREATE INDEX idx_members_phone1         ON public.members(phone1);
CREATE INDEX idx_members_customer_type  ON public.members(customer_type);
CREATE INDEX idx_members_registered_at  ON public.members(registered_at);
-- あいまい検索用(将来):
CREATE INDEX idx_members_name_trgm      ON public.members USING gin(name gin_trgm_ops);

CREATE TRIGGER trg_members_updated_at
  BEFORE UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 5. inquiries (問合せ)  ※既存ID "TA-XXXXXXX"
-- ============================================================================
CREATE TABLE public.inquiries (
  id            text PRIMARY KEY,                    -- "TA-0000xxxxx"
  form_id       int REFERENCES public.forms(id),
  member_id     text REFERENCES public.members(id),  -- 会員化後にセット
  name          text,
  name_kana     text,
  email         text,
  phone         text,
  postal_code   text,
  address       text,
  ad_id         text,
  extra         jsonb NOT NULL DEFAULT '{}'::jsonb,
  registered_at timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX idx_inquiries_form          ON public.inquiries(form_id);
CREATE INDEX idx_inquiries_member        ON public.inquiries(member_id);
CREATE INDEX idx_inquiries_registered_at ON public.inquiries(registered_at DESC);
CREATE INDEX idx_inquiries_email         ON public.inquiries(email);
CREATE INDEX idx_inquiries_phone         ON public.inquiries(phone);
CREATE INDEX idx_inquiries_extra_gin     ON public.inquiries USING gin(extra);

CREATE TRIGGER trg_inquiries_updated_at
  BEFORE UPDATE ON public.inquiries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 6. applications (申込情報)  ※既存ID "M-XXXXXXX"
-- ============================================================================
CREATE TABLE public.applications (
  id                       text PRIMARY KEY,           -- "M-0000xxxxx"
  inquiry_id               text REFERENCES public.inquiries(id),
  member_id                text NOT NULL REFERENCES public.members(id),
  project_id               int  NOT NULL REFERENCES public.projects(id),
  application_date         date NOT NULL,
  status                   text CHECK (status IN ('対応中','未購入','完了','出金','資金移動')),
  flow_type                text CHECK (flow_type IN ('入金','出金','資金移動','W') OR flow_type IS NULL),
  owner_id                 uuid REFERENCES public.users(id),
  owner_name_raw           text,
  acquirer_id              uuid REFERENCES public.users(id),
  acquirer_name_raw        text,
  contract_sent_date       date,
  start_month              text,
  start_datetime           timestamptz,
  scheduled_payment_date   date,
  scheduled_amount         numeric(18,2),
  payment_date             date,
  payment_amount           numeric(18,2),
  crypto_excluded_amount   numeric(18,2),
  yen_interest             numeric(8,4),
  withdrawal_amount        numeric(18,2),
  withdrawal_date          date,
  transfer_date            date,
  transfer_amount          numeric(18,2),
  transfer_to              text,
  contract_period          text,
  extra                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);

CREATE INDEX idx_apps_member             ON public.applications(member_id)        WHERE deleted_at IS NULL;
CREATE INDEX idx_apps_project            ON public.applications(project_id)       WHERE deleted_at IS NULL;
CREATE INDEX idx_apps_owner              ON public.applications(owner_id)         WHERE deleted_at IS NULL;
CREATE INDEX idx_apps_status             ON public.applications(status);
CREATE INDEX idx_apps_application_date   ON public.applications(application_date DESC);
CREATE INDEX idx_apps_payment_date       ON public.applications(payment_date);
CREATE INDEX idx_apps_extra_gin          ON public.applications USING gin(extra);

CREATE TRIGGER trg_apps_updated_at
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 7. activities (活動履歴) ★中核オブジェクト・120万件規模
-- ============================================================================
CREATE TABLE public.activities (
  id                    bigserial PRIMARY KEY,
  legacy_sf_id          text UNIQUE,                    -- 旧Salesforce ID
  owner_id              uuid REFERENCES public.users(id),
  member_id             text REFERENCES public.members(id),
  created_by_id         uuid REFERENCES public.users(id),
  duration_minutes      int,
  todo_time             numeric(8,2),
  description           text,
  d_bunrui              text,
  m_bunrui              text,
  s_bunrui              text,
  registered_date       date,
  registered_datetime   timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

-- 必須インデックス(運用時パフォーマンス確保)
CREATE INDEX idx_act_member_date  ON public.activities(member_id, registered_datetime DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_act_owner_date   ON public.activities(owner_id,  registered_datetime DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_act_bunrui       ON public.activities(d_bunrui, m_bunrui, s_bunrui);
CREATE INDEX idx_act_reg_date     ON public.activities(registered_date);
CREATE INDEX idx_act_reg_datetime ON public.activities(registered_datetime DESC);

-- 将来の全文検索(必要に応じてコメントアウト解除):
-- CREATE INDEX idx_act_desc_trgm ON public.activities USING gin(description gin_trgm_ops);

CREATE TRIGGER trg_activities_updated_at
  BEFORE UPDATE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- ビュー: 月次活動集計 (Materialized View 案 — 将来用)
-- ============================================================================
-- CREATE MATERIALIZED VIEW mv_monthly_activities AS
-- SELECT
--   owner_id,
--   date_trunc('month', registered_datetime)::date AS month,
--   d_bunrui,
--   m_bunrui,
--   COUNT(*)                 AS activity_count,
--   COALESCE(SUM(duration_minutes), 0) AS total_minutes
-- FROM public.activities
-- WHERE deleted_at IS NULL
-- GROUP BY owner_id, date_trunc('month', registered_datetime), d_bunrui, m_bunrui;
-- CREATE INDEX ON mv_monthly_activities(owner_id, month);

-- ============================================================================
-- 末尾コメント
-- ============================================================================
-- 次のmigration: 02_rls_policies.sql (Row Level Security)
-- 次のmigration: 03_seed_projects.sql (案件マスタ44件投入)
