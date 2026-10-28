-- ============================================================================
-- migration 135: 対応歴の「新しい順」の並びに合う索引 (2026-10-29)
--                CLAUDE.md §5.7「インデックス」
--
-- 会員詳細(接触種別の選択肢・最近の分類の組み合わせ)と対応歴一覧は、対応歴を
-- 「registered_datetime DESC NULLS LAST, id DESC」(日時が空の行は最後)で並べる。
-- 既存の idx_act_reg_datetime は (registered_datetime DESC) = NULLS FIRST のため並べ替えに使われず、
-- 表示のたびに約 78 万件を全部並べ替えていた(2026-10-29 本番で 1 回目 8 秒で時間切れ / 2 回目 1.2 秒。
-- 並びを索引に合わせると 0.1 秒)。メール一覧の migration 91 と同じ考え方で、並びに完全一致する索引を足す。
-- アプリのコードは変えない。
--
-- ※ CONCURRENTLY はトランザクションの中では実行できないため、SQL Editor では 1 文で実行する。
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_act_reg_dt_nulls_last
  ON public.activities (registered_datetime DESC NULLS LAST, id DESC)
  WHERE deleted_at IS NULL;
