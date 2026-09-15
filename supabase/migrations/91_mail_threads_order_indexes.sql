-- ============================================================================
-- migration 91: メーラー一覧の並び順に合うインデックス (2026-09-15) / CLAUDE.md §5.15
--
-- 目的:
--   一覧・前後移動の並びは「last_message_at DESC NULLS LAST, id DESC」だが、既存のインデックス
--   (migration 76 / 82)は「last_message_at DESC」(NULLS FIRST)のため並び替えに使われず、
--   取込候補(約48万スレッド)では毎ページ全件を並べ替えていた(1ページ 1.5〜2.5 秒。追加読み込みが
--   途中で止まる原因の一つ)。並び順と完全に一致するインデックスに置き換える。
--
-- 方針:
--   - 取込候補用: (last_message_at DESC NULLS LAST, id DESC) WHERE is_import_candidate AND deleted_at IS NULL
--   - 受信箱ごと: (mail_box_id, last_message_at DESC NULLS LAST, id DESC) WHERE deleted_at IS NULL
--   - すべての受信箱: (last_message_at DESC NULLS LAST, id DESC) WHERE deleted_at IS NULL
--   - 置き換えた旧インデックス(idx_mail_threads_import_candidate / idx_mail_threads_box_last)は削除
--   - スキーマ(列)の変更なし。データも変えない
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_mail_threads_candidate_order
  ON public.mail_threads (last_message_at DESC NULLS LAST, id DESC)
  WHERE is_import_candidate AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mail_threads_box_order
  ON public.mail_threads (mail_box_id, last_message_at DESC NULLS LAST, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mail_threads_all_order
  ON public.mail_threads (last_message_at DESC NULLS LAST, id DESC)
  WHERE deleted_at IS NULL;

DROP INDEX IF EXISTS public.idx_mail_threads_import_candidate;
DROP INDEX IF EXISTS public.idx_mail_threads_box_last;
