-- ============================================================================
-- migration 82: メーラーの「取込候補」フォルダ (2026-09-14) / CLAUDE.md §5.15
--
-- 目的:
--   旧 Salesforce の「メール to リード」用アドレス(y3awtd-hirayama-p@hdbronze.htdb.jp)を
--   宛先(To/Cc)に含むメール(フォーム通知など)は、リード/問合せとして取り込むべき候補。
--   これをメーラーの左フォルダ「取込候補」で一覧できるよう、スレッドに印を持たせる。
--
-- 方針:
--   - 判定は受信時にアプリ側の純粋関数 isImportCandidate()(lib/domain/mail_import_candidates.ts)
--     で行い、結果を mail_threads.is_import_candidate に保存する(分類 category と同じ考え方)。
--     一覧は列の等価条件だけで引けるので、80万件超の mail_messages を毎回走査しない。
--   - 判定アドレスはアプリ側の定数 MAIL_IMPORT_CANDIDATE_ADDRESSES(lib/domain/mail_types.ts)が
--     正。下の再集計 SQL は同じアドレスを直書きしているので、定数を変えたら合わせて直して
--     再実行する。
--   - 受信箱・分類・状態は変えない(候補は「その他」や各受信箱にそのまま残り、フォルダ
--     「取込候補」は横断的な絞り込みとして働く)。
-- ============================================================================

ALTER TABLE public.mail_threads
  ADD COLUMN IF NOT EXISTS is_import_candidate boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.mail_threads.is_import_candidate IS
  '取込候補(旧「メール to リード」宛先を To/Cc に含むメールを持つスレッド)。受信時に判定。CLAUDE.md §5.15';

-- フォルダ「取込候補」の一覧・件数用(該当スレッドだけを最終メール日時順で引く)
CREATE INDEX IF NOT EXISTS idx_mail_threads_import_candidate
  ON public.mail_threads(last_message_at DESC)
  WHERE is_import_candidate AND deleted_at IS NULL;

-- 既存スレッドの再集計(過去データ取込分・SES 受信分の両方)。
-- 判定アドレスを変えたときも、この UPDATE を実行し直す(true → false には戻さない。
-- 戻したい場合は先に UPDATE public.mail_threads SET is_import_candidate = false を実行する)。
-- 保存済みの宛先は小文字化されているため、小文字で完全一致させる。
UPDATE public.mail_threads AS t
SET is_import_candidate = true
FROM (
  SELECT DISTINCT m.thread_id
  FROM public.mail_messages m
  WHERE m.to_addresses @> ARRAY['y3awtd-hirayama-p@hdbronze.htdb.jp']
     OR m.cc_addresses @> ARRAY['y3awtd-hirayama-p@hdbronze.htdb.jp']
) AS c
WHERE t.id = c.thread_id
  AND NOT t.is_import_candidate;
