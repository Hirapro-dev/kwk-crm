-- ============================================================================
-- migration 87: メール取込ルール(mail_import_rules) (2026-09-15) / CLAUDE.md §5.16
--
-- 目的:
--   取込候補のフォーム通知メールから問合せ(TA-)を自動作成するためのルール。
--   メールの型ごとに1件。一致条件(受信箱・差出人・件名含有)、フォーム名の取り方、
--   本文の「ラベル: 値」→ 問合せ項目の対応を持つ。
--   本 migration はルールの定義(段階②)のみ。自動作成(段階③)で inquiries / mail_messages
--   への列追加を別 migration で行う。
--
-- 方針:
--   - field_map は jsonb(ラベル → 項目名)。項目名はアプリ側のホワイトリスト
--     (name / name_kana / email / phone / postal_code / address / ad_id / registered_at /
--     extra:<キー>)で検証してから保存する(normalizeFieldMap)。
--   - RLS: 全員 SELECT(受信時の判定・画面表示に必要)/ 変更は admin のみ。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mail_import_rules (
  id                serial PRIMARY KEY,
  name              text NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  sort_order        integer NOT NULL DEFAULT 100,           -- 判定順(小さい順。同値は id 順)
  mail_box_id       integer REFERENCES public.mail_boxes(id), -- NULL = 受信箱で絞らない
  from_address      text,                                   -- NULL = 差出人で絞らない(小文字)
  subject_contains  text,                                   -- NULL = 件名で絞らない
  form_name_source  text NOT NULL
                    CHECK (form_name_source IN ('subject', 'subject_without_name', 'body_line', 'body_label', 'fixed')),
  form_name_param   text,                                   -- 行番号 / ラベル / 固定文字列
  field_map         jsonb NOT NULL DEFAULT '{}'::jsonb,     -- 本文のラベル → 問合せ項目
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mail_import_rules IS
  'メール取込ルール(取込候補のフォーム通知メール → 問合せ)。CLAUDE.md §5.16';

DROP TRIGGER IF EXISTS trg_mail_import_rules_updated_at ON public.mail_import_rules;
CREATE TRIGGER trg_mail_import_rules_updated_at
  BEFORE UPDATE ON public.mail_import_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.mail_import_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mail_import_rules_select ON public.mail_import_rules;
DROP POLICY IF EXISTS mail_import_rules_write  ON public.mail_import_rules;
CREATE POLICY mail_import_rules_select ON public.mail_import_rules FOR SELECT USING (true);
CREATE POLICY mail_import_rules_write  ON public.mail_import_rules FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());
