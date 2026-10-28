-- ============================================================================
-- migration 133: メーラーの「送信済み」「自分の送信履歴」フォルダ用の索引 (2026-10-28)
--                CLAUDE.md §5.15「送信済み・自分の送信履歴」
--
-- 2026-10-28 ユーザー要望: 送ったメールが「対応完了」に混ざって探しにくいため、メールディーラーのような
-- 「送信済み」フォルダ(過去のメールディーラー分 約 22 万通を含む)と「自分の送信履歴」(CRM から自分が送った分)を作る。
-- 送信メールを新しい順に 1 通ずつ並べるため、送信メール(direction = 'out')だけの索引を足す。
-- 表の列は変えない。
--
-- ※ CONCURRENTLY はトランザクションの中では実行できないため、SQL Editor では 1 文ずつ実行する。
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_messages_out_sent
  ON public.mail_messages (sent_at DESC, id DESC)
  WHERE direction = 'out';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_messages_out_sender_sent
  ON public.mail_messages (sender_user_id, sent_at DESC, id DESC)
  WHERE direction = 'out' AND sender_user_id IS NOT NULL;
