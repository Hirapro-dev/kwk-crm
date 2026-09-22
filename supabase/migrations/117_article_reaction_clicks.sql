-- ============================================================================
-- 記事反応リスト: クリック履歴 CSV の取込と会員照合(2026-09-23)
-- CLAUDE.md §5.13b
--
-- 目的:
--   Salesforce 形式(反応ID KH… / 会員ID)の CSV に代えて、配信ツールの「クリック履歴」CSV
--   (クリック日時 / 読者メールアドレス / 読者名前)から記事反応を作る。取込時に備考(記事名)と
--   配信媒体を画面で指定し、1 人(メールアドレス)1 件にまとめる。会員はメールアドレスの完全一致で
--   後から一括照合する(一覧のチェックボックス)。
--
-- 変更:
--   1) 列追加: email(小文字) / registered_at(登録日時) / remarks(備考 = 記事名)
--   2) 採番: gen_article_reaction_id() = 'KH' + 8 桁の連番(KH01000000 から。Salesforce の
--      KH0000xxxx 台と離す。K- / TA- / M- と同じ考え方)。id に DEFAULT を付ける
--      (Salesforce 形式の取込は id を渡すので影響なし)
--   3) 同じメール + 同じ備考は 1 件(部分ユニーク。再取込しても増えない)
--   4) 項目管理(field_definitions)に 3 列を登録
-- ============================================================================

ALTER TABLE public.article_reactions
  ADD COLUMN IF NOT EXISTS email         text,
  ADD COLUMN IF NOT EXISTS registered_at timestamptz,
  ADD COLUMN IF NOT EXISTS remarks       text;

COMMENT ON COLUMN public.article_reactions.email IS 'メールアドレス(小文字)。クリック履歴 CSV の取込分。会員照合のキー';
COMMENT ON COLUMN public.article_reactions.registered_at IS '登録日時(いちばん早いクリック日時)';
COMMENT ON COLUMN public.article_reactions.remarks IS '備考(取込時に指定した記事名)';

-- 2) 採番
CREATE SEQUENCE IF NOT EXISTS public.article_reactions_id_seq START WITH 1000000;

CREATE OR REPLACE FUNCTION public.gen_article_reaction_id()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT 'KH' || lpad(nextval('public.article_reactions_id_seq')::text, 8, '0');
$$;

ALTER TABLE public.article_reactions
  ALTER COLUMN id SET DEFAULT public.gen_article_reaction_id();

-- 3) 同じメール + 同じ備考は 1 件(削除済みは除く)。Salesforce 形式の行は email が NULL なので対象外
CREATE UNIQUE INDEX IF NOT EXISTS uq_artreact_email_remarks
  ON public.article_reactions(email, remarks)
  WHERE deleted_at IS NULL AND email IS NOT NULL AND remarks IS NOT NULL;

-- 会員照合・検索用
CREATE INDEX IF NOT EXISTS idx_artreact_email
  ON public.article_reactions(email) WHERE deleted_at IS NULL;

-- 4) 項目管理(一覧・詳細に表示。migration 51 と同じ形式)
INSERT INTO public.field_definitions (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system, sort_order_list, sort_order_detail) VALUES
  ('article_reactions', 'registered_at', '登録日時',       'datetime', true, true, true, 25, 25),
  ('article_reactions', 'email',         'メールアドレス', 'text',     true, true, true, 35, 35),
  ('article_reactions', 'remarks',       '備考',           'text',     true, true, true, 95, 95)
ON CONFLICT (object_id, field_name) DO NOTHING;
