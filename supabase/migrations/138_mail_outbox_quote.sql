-- ============================================================================
-- migration 138: 送信待ちメールに返信の引用(テキスト版・HTML 版)を持たせる (2026-10-30)
--                CLAUDE.md §5.15「返信の引用(HTML)」
--
-- 目的(2026-10-30 ユーザー決定):
--   返信の引用を HTML のまま相手に送る(メールディーラーと同じ)。承認待ちにしてから実際に送るまでの間、
--   依頼した時点の引用をそのまま保存しておき、承認者が見た内容と送る内容を必ず同じにする。
--
-- 列:
--   quote_text  … テキスト版の引用(「> 」付き)。送るときに text_body(本文 + 署名)の後ろに付ける
--   quote_html  … HTML 版の引用(無害化済み)。送るときに HTML 本文の後ろに付ける
--   どちらも NULL なら従来どおり(引用なし、または引用を text_body に含めていた 2026-10-30 より前の行)。
--
-- 既存の行は書き換えない。RLS・権限は mail_outbox の既存の設定のまま(書込みは Server Action のサービスロールだけ)。
-- ============================================================================

ALTER TABLE public.mail_outbox
  ADD COLUMN IF NOT EXISTS quote_text text,
  ADD COLUMN IF NOT EXISTS quote_html text;

COMMENT ON COLUMN public.mail_outbox.quote_text IS '返信の引用(テキスト版)。送信時に text_body の後ろに付ける。NULL = なし(または text_body に含む旧形式)';
COMMENT ON COLUMN public.mail_outbox.quote_html IS '返信の引用(HTML 版・無害化済み)。送信時に HTML 本文の後ろに付ける。NULL = なし';
