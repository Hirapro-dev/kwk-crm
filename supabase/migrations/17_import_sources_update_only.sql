-- =============================================================================
-- import_sources に「更新のみ」モード列を追加 (CLAUDE.md §5.10c 拡張)
-- =============================================================================
-- 目的:
--   定期取込(Drive)で「既存IDの更新のみ・新規レコードは作成しない」を選べるようにする。
-- 影響範囲: import_sources に nullable でない boolean 列を1つ追加(既定 false)。冪等。
-- =============================================================================

ALTER TABLE public.import_sources
  ADD COLUMN IF NOT EXISTS update_only boolean NOT NULL DEFAULT false;
