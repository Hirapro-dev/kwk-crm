-- ============================================================================
-- 記事反応リスト(article_reactions)テーブル追加 (2026-07)
-- CLAUDE.md §4.1 オブジェクト一覧 / §5 テーブル定義に準拠(新オブジェクト §5.13相当)
--
-- 目的:
--   会員がメルマガ等の配信に「反応(クリック等)」した記録を1行=1反応で保持する。
--   定期取込(import_sources)で Google Drive の CSV を upsert する取込専用オブジェクト。
--
-- 元CSVヘッダー → カラム対応:
--   ID → id(KH…)          / 日付 → reacted_date       / 配信媒体 → media
--   配信ツール → tool       / 種類 → reaction_type       / フォーム名 → form_name
--   会員氏名（漢字）→ member_name
--   会員氏名(旧SF会員ID) → member_legacy_sf_id
--   会員ID(K-) → member_id(members へ紐付け) / 詳細 → detail
--
-- 方針(既存テーブル共通):
--   - 元ID(KH…)を主キーに温存(text)。再取込しても id で突合し重複しない。
--   - 論理削除(deleted_at)。物理削除は行わない。
--   - created_at/updated_at + set_updated_at トリガー。
--   - RLS: 全ログインユーザー SELECT可 / 書込は admin のみ(projects/forms と同型)。
--     取込はサービスロールで実行するため RLS を迂回して upsert できる。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.article_reactions (
  id                    text PRIMARY KEY,                    -- 反応ID (KH…)
  reacted_date          date,                                -- 日付
  media                 text,                                -- 配信媒体 (KAWARA版正会員 等)
  tool                  text,                                -- 配信ツール (メルマガ 等)
  reaction_type         text,                                -- 種類 (クリック 等)
  form_name             text,                                -- フォーム名 (空可)
  member_name           text,                                -- 会員氏名(漢字) スナップショット
  member_legacy_sf_id   text,                                -- 旧Salesforce会員ID (0015i…)
  member_id             text REFERENCES public.members(id),  -- 会員ID (K-)。無ければ NULL
  detail                text,                                -- 詳細
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

-- 会員詳細ページでの反応履歴取得用 / 日付での絞り込み用
CREATE INDEX IF NOT EXISTS idx_artreact_member_date
  ON public.article_reactions(member_id, reacted_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_artreact_date
  ON public.article_reactions(reacted_date DESC) WHERE deleted_at IS NULL;

CREATE TRIGGER trg_article_reactions_updated_at
  BEFORE UPDATE ON public.article_reactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- RLS: 全員 SELECT / 書込は admin のみ(projects・forms と同型)
-- ============================================================================
ALTER TABLE public.article_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS article_reactions_select ON public.article_reactions;
DROP POLICY IF EXISTS article_reactions_insert ON public.article_reactions;
DROP POLICY IF EXISTS article_reactions_update ON public.article_reactions;
DROP POLICY IF EXISTS article_reactions_delete ON public.article_reactions;

CREATE POLICY article_reactions_select ON public.article_reactions
  FOR SELECT USING (deleted_at IS NULL);
CREATE POLICY article_reactions_insert ON public.article_reactions
  FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY article_reactions_update ON public.article_reactions
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY article_reactions_delete ON public.article_reactions
  FOR DELETE USING (public.is_admin());
