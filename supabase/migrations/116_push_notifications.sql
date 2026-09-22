-- ============================================================================
-- migration 116: プッシュ通知の購読と通知設定 (2026-09-22) / CLAUDE.md §5.20 / §13
--
-- 目的:
--   担当に割り当てられたとき・コメントで呼ばれたときに、ブラウザのプッシュ通知(Web Push)とメールで知らせる。
--
-- 方針:
--   - push_subscriptions: 端末(ブラウザ)ごとの購読情報。1 ユーザーが複数端末を持てる。endpoint は世界で一意。
--     送信に失敗(404 / 410 = 購読の失効)したら行を消す。
--   - user_notification_settings: ユーザーごとの ON/OFF(プッシュ / メール)。行が無ければ両方 ON。
--   - RLS: どちらも自分の行だけ(送信時の参照はサービスロール)。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          bigserial PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint    text        NOT NULL UNIQUE,
  p256dh      text        NOT NULL,
  auth        text        NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
COMMENT ON TABLE public.push_subscriptions IS 'Web Push の購読(端末ごと)。CLAUDE.md §5.20';
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS public.user_notification_settings (
  user_id       uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  push_enabled  boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.user_notification_settings IS 'ユーザーごとの通知の ON/OFF(プッシュ / メール)。行が無ければ両方 ON。CLAUDE.md §5.20';

ALTER TABLE public.push_subscriptions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notification_settings  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_subscriptions_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_own ON public.push_subscriptions
  FOR ALL USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS user_notification_settings_own ON public.user_notification_settings;
CREATE POLICY user_notification_settings_own ON public.user_notification_settings
  FOR ALL USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
