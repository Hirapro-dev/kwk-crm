-- ============================================================================
-- migration 137: 「自分の担当」の件数用の索引 (2026-10-29)
--                CLAUDE.md §5.15「件数表(タブ・左フォルダの件数)」
--
-- 担当で絞った件数は件数表(migration 136)に区分が無いため、その場で数える。
-- 左フォルダ「自分の担当」(担当 = 自分・未対応・通常)と、担当で絞ったときのタブ件数を索引だけで数えられるようにする
-- (既存の idx_mail_threads_assignee は担当だけで、状態・分類を見るために行を 1 件ずつ読んでいた)。
--
-- ※ CONCURRENTLY はトランザクションの中では実行できないため、SQL Editor では 1 文で実行する。
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_mail_threads_assignee_status
  ON public.mail_threads (assignee_id, status, category)
  WHERE deleted_at IS NULL;
