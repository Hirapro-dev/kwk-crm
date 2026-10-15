-- ============================================================================
-- migration 124: メーラーの送信承認と送信予約(mail_outbox) (2026-10-15)
--                CLAUDE.md §5.15「送信の承認・送信予約」/ §8.1 /mail/outbox
--
-- 目的:
--   メーラーから送るメール(返信・新規)をすぐには送らず「承認待ち」にし、
--   承認者(admin / manager)が内容を確認して承認したときに送る(対象は全メール。2026-10-15 ユーザー決定)。
--   送信日時を指定した予約も同じ表で持ち、承認済みで予約日時になったものを定期実行(Vercel Cron)で送る。
--
-- 方針:
--   - 送る前のメールは mail_messages には入れない(mail_messages は送受信済みの記録。対応歴トリガー migration 93 も
--     mail_messages の INSERT で動くため、送る前に入れると未送信のメールが対応歴に載る)。送った時点で mail_messages を作り、
--     sent_message_id で紐付ける。
--   - 状態は 承認待ち(pending) / 差し戻し(rejected) / 予約中(approved: 承認済みで予約日時待ち) / 送信中(sending) /
--     送信済み(sent) / 送信失敗(failed) / 取消(cancelled)。
--     状態の遷移はアプリ側(lib/domain/mail_outbox.ts の純粋関数)で決め、書込みはサーバーのサービスロールで行う。
--   - RLS: SELECT は全ロール(メールと同じ)。INSERT / UPDATE / DELETE のポリシーは設けない(サービスロールのみ書ける)。
--   - 物理削除はしない(取消は status = cancelled)。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mail_outbox (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               text NOT NULL CHECK (kind IN ('reply', 'new')),     -- 返信 / 新規
  thread_id          uuid REFERENCES public.mail_threads(id),            -- 返信先のスレッド(新規は送信時に作って入れる)
  mail_box_id        int  NOT NULL REFERENCES public.mail_boxes(id),     -- 送信元の受信箱
  from_name          text,                                               -- 差出人表示名(NULL = アドレスのみ)
  to_addresses       text[] NOT NULL DEFAULT '{}',
  cc_addresses       text[] NOT NULL DEFAULT '{}',
  subject            text NOT NULL DEFAULT '',
  text_body          text NOT NULL,                                      -- 送る本文(署名・引用を含めた完成形)
  in_reply_to        text,                                               -- 返信のスレッド用ヘッダ(申請時に決める)
  references_header  text,
  scheduled_at       timestamptz,                                        -- 送信予約日時(NULL = 承認したらすぐ送る)
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'rejected', 'approved', 'sending', 'sent', 'failed', 'cancelled')),
  created_by         uuid NOT NULL REFERENCES public.users(id),          -- 作成者(送信者として記録する)
  approved_by        uuid REFERENCES public.users(id),
  approved_at        timestamptz,
  rejected_by        uuid REFERENCES public.users(id),
  rejected_at        timestamptz,
  reject_reason      text,
  cancelled_by       uuid REFERENCES public.users(id),
  cancelled_at       timestamptz,
  sent_at            timestamptz,
  sent_message_id    uuid REFERENCES public.mail_messages(id),
  last_error         text,                                               -- 送信失敗の内容(SES のエラー要約)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.mail_outbox IS 'メーラーの送信待ちメール(承認待ち・送信予約)。CLAUDE.md §5.15';

-- 一覧(状態ごと・新しい順)と、定期実行(承認済みで予約日時を過ぎたもの)用
CREATE INDEX IF NOT EXISTS idx_mail_outbox_status_created ON public.mail_outbox (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_outbox_due ON public.mail_outbox (scheduled_at) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_mail_outbox_thread ON public.mail_outbox (thread_id) WHERE thread_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_mail_outbox_updated_at ON public.mail_outbox;
CREATE TRIGGER trg_mail_outbox_updated_at
  BEFORE UPDATE ON public.mail_outbox
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.mail_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mail_outbox_select ON public.mail_outbox;
CREATE POLICY mail_outbox_select ON public.mail_outbox FOR SELECT TO authenticated USING (true);
