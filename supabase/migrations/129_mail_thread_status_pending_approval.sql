-- ============================================================================
-- migration 129: メールスレッドの状態に「承認待ち」を追加 (2026-10-22)
--                CLAUDE.md §5.15「送信の承認・送信予約」
--
-- 目的(2026-10-22 ユーザー指定):
--   返信が承認待ち(mail_outbox.status = pending)の間、そのスレッドの状態を「承認待ち」にし、
--   一覧の「対応中」タブに出す(「対応中」タブ = 状態が 対応中 または 承認待ち)。
--
-- 方針:
--   - 状態の切り替えはアプリ側(lib/domain/mail_outbox.ts の純粋関数 threadStatusAfterOutboxChange と
--     lib/mail/outbox_thread_status.ts)で行う。承認依頼・修正で「承認待ち」、差し戻し・取消・予約中・送信失敗で
--     承認待ちが残っていなければ「対応中」、送信したら「完了」(承認待ちが残っていれば「承認待ち」のまま)。
--   - 画面の状態の選択肢(手動の変更)には出さない(送信待ちメールと食い違うため)。
--   - 2026-10-22 時点で承認待ちの送信待ちメールは 0 件のため、既存データの書き換えは無い。
-- ============================================================================

-- mail_threads は約 117 万行。制約の付け直しで表を長く止めないよう、NOT VALID で付けてから
-- 別の文で検証する(検証中もメールの受信・更新は止まらない)。
ALTER TABLE public.mail_threads DROP CONSTRAINT IF EXISTS mail_threads_status_check;
ALTER TABLE public.mail_threads
  ADD CONSTRAINT mail_threads_status_check
  CHECK (status IN ('未対応', '対応中', '完了', '承認待ち')) NOT VALID;
ALTER TABLE public.mail_threads VALIDATE CONSTRAINT mail_threads_status_check;
