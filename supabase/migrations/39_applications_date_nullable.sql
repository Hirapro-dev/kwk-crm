-- ============================================================================
-- applications.application_date を NULL 許容に変更 (2026-06)
-- CLAUDE.md §5.6
--
-- 背景: 申し込み情報CSVに「申込日」が空の行が多数あり、それらも取り込めるよう
--       NOT NULL 制約を外す。アプリは日付NULLを空欄表示として扱う。
-- ============================================================================

ALTER TABLE public.applications ALTER COLUMN application_date DROP NOT NULL;
