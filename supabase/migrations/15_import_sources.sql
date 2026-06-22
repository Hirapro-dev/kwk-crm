-- =============================================================================
-- 定期取込ソース (Google Drive 連携) マスタ (CLAUDE.md §5.10c)
-- =============================================================================
-- 目的:
--   各オブジェクトに「Google Drive 上の指定CSV」を紐づけ、ボタン1つで取込(upsert)する。
--   取込エンジンは突発アップロード(#2)と共通。本テーブルはファイル指定と実行履歴のみ。
--
-- 影響範囲:
--   - 新規テーブル import_sources を1つ追加するのみ。既存テーブルは触らない。
--   - RLS は全員 SELECT、admin のみ INSERT/UPDATE/DELETE。
--   - 未適用・SA未設定でも画面はフォールバックで動作する。
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.import_sources (
  object           text PRIMARY KEY,                 -- members / applications / inquiries / projects
  drive_file_id    text,                             -- Google Drive ファイルID
  enabled          boolean NOT NULL DEFAULT false,
  note             text,
  last_run_at      timestamptz,
  last_run_status  text,                             -- success / error
  last_run_message text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_import_sources_updated_at ON public.import_sources;
CREATE TRIGGER trg_import_sources_updated_at
  BEFORE UPDATE ON public.import_sources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========================================================
-- RLS: 全員 SELECT、admin のみ INSERT/UPDATE/DELETE
-- ========================================================
ALTER TABLE public.import_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_sources_select ON public.import_sources;
CREATE POLICY import_sources_select ON public.import_sources
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS import_sources_modify ON public.import_sources;
CREATE POLICY import_sources_modify ON public.import_sources
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin' AND u.deleted_at IS NULL)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin' AND u.deleted_at IS NULL)
  );

-- ========================================================
-- 初期シード: 取込対象オブジェクト(未設定状態で行だけ用意)
-- ========================================================
INSERT INTO public.import_sources (object, enabled) VALUES
  ('members', false),
  ('applications', false),
  ('inquiries', false),
  ('projects', false)
ON CONFLICT (object) DO NOTHING;
