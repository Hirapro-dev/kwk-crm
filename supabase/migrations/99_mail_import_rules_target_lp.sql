-- ============================================================================
-- migration 99: メール取込ルールの取込先「LP」 (2026-09-16) / CLAUDE.md §5.16 / §5.17
--
-- 内容(ユーザー決定 2026-09-16):
--   1. mail_import_rules に取込先 target(inquiry = 問合せ / lp = LP)と、フォーム名に含むキーワード
--      form_name_contains(空白区切り・すべて含む。ルールの取り方で決めたフォーム名に対して判定)を追加。
--      「フォーム名に LP / メールマガジン を含むフォームは LP へ」をルールで表す
--   2. lp_entries に元メールの識別子 source_mail_message_id(1メール1件の冪等キー。問合せと同方式)を追加
--   3. mail_messages に作成した LP への参照 lp_entry_id を追加(取込候補の「処理結果」に LP へのリンクを出す)
--   ※ LP へ取り込むときは会員の紐付けをしない(メールだけの照合は誤紐付けの恐れがあるため。member_id は NULL)
--   ※ LP の ID は問合せと同じ gen_inquiry_id()(TA- 9桁。Salesforce でも LP は TA- だった。同じ連番なので衝突しない)
-- ============================================================================

-- 1) mail_import_rules
ALTER TABLE public.mail_import_rules
  ADD COLUMN IF NOT EXISTS target text NOT NULL DEFAULT 'inquiry'
    CHECK (target IN ('inquiry', 'lp')),
  ADD COLUMN IF NOT EXISTS form_name_contains text;

COMMENT ON COLUMN public.mail_import_rules.target IS
  '取込先: inquiry=問合せ(既定) / lp=LP(lp_entries。会員の紐付けはしない)';
COMMENT ON COLUMN public.mail_import_rules.form_name_contains IS
  'フォーム名に含むキーワード(空白区切り・すべて含む)。このルールの取り方で決めたフォーム名に対して判定する。NULL=絞らない';

-- 2) lp_entries
ALTER TABLE public.lp_entries
  ADD COLUMN IF NOT EXISTS source_mail_message_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lp_entries_source_mail_message_id
  ON public.lp_entries(source_mail_message_id)
  WHERE source_mail_message_id IS NOT NULL;

COMMENT ON COLUMN public.lp_entries.source_mail_message_id IS
  'メール取込(§5.16)で作った LP の元メール(mail_messages.message_id)。1メール1件の冪等キー';

-- 3) mail_messages
ALTER TABLE public.mail_messages
  ADD COLUMN IF NOT EXISTS lp_entry_id text REFERENCES public.lp_entries(id);

COMMENT ON COLUMN public.mail_messages.lp_entry_id IS
  '取込候補の処理で作成した LP(lp_entries.id)。問合せを作ったときは inquiry_id に入る';
