-- ============================================================================
-- migration 90: メール取込ルールに「本文に含むキーワード」条件を追加 (2026-09-15) / CLAUDE.md §5.16
--
-- 目的:
--   「受信データ」と「本人確認完了」の区別が件名に無く本文1行目にしかないメールがある
--   (件名「【Google広告経由】【未来予測分析レポート請求】○○ 様（社名）」)。
--   件名キーワードだけでは判定順に頼るしかないため、本文のキーワードでも絞れるようにする。
--
-- 方針:
--   - subject_contains と同じ形式(空白区切りのキーワード、すべて含むときに一致)。
--     判定はアプリ側の純粋関数 ruleMatches(lib/domain/mail_import_rules.ts)。
--     本文はテキスト版、無ければ HTML 版をテキスト化したもの(mailBodyText)。
--   - NULL = 本文で絞らない(既存ルールはそのまま動く)。
-- ============================================================================

ALTER TABLE public.mail_import_rules
  ADD COLUMN IF NOT EXISTS body_contains text;

COMMENT ON COLUMN public.mail_import_rules.body_contains IS
  '本文に含むキーワード(空白区切り、すべて含むときに一致)。NULL = 本文で絞らない。CLAUDE.md §5.16';
