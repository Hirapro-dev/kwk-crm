-- ============================================================================
-- migration 95: LP(lp_entries) オブジェクト追加 (2026-09-16) / CLAUDE.md §5.17
--
-- 目的:
--   Salesforce の問合せのうち、LP・メルマガ登録系フォーム(54 種類、約 5.8 万件)は CRM の問合せ取込の
--   対象外だった。これを問合せとは別のオブジェクト「LP」として保持し、一覧・詳細・会員詳細の関連で
--   参照できるようにする(問合せの件数・集計・レポートには混ぜない)。
--
-- 方針(出金管理 §5.13 と同じ取込専用オブジェクトの形):
--   - 元の問合せID(TA-)を主キーに温存(text)。再取込しても id で突合し重複しない。
--   - 会員ID(K-)は既存会員にあれば member_id に紐付け、無ければ NULL。
--   - 論理削除(deleted_at)。created_at/updated_at + set_updated_at トリガー。
--   - RLS: SELECT は全ロール(問合せと同じ扱い)、書込は admin のみ(取込はサービスロール)。
--   - object_definitions / field_definitions / nav_items に登録し、一覧のカラムは項目管理で制御。
--   - 一覧からの一括削除(§5.14)の対象に加える(soft_delete_records に分岐追加)。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lp_entries (
  id               text PRIMARY KEY,                    -- 問合せID (TA-XXXXXXXXX)
  member_id        text REFERENCES public.members(id),  -- 会員ID (K-)。無ければ NULL
  registered_month text,                                -- 登録月 (YYYY/MM)
  form_name        text,                                -- フォーム名(名称のまま保持)
  ad_id            text,                                -- 広告ID
  email            text,                                -- メールアドレス(小文字)
  name             text,                                -- 氏名
  name_kana        text,                                -- 氏名かな
  registered_at    timestamptz,                         -- 登録日時
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

COMMENT ON TABLE public.lp_entries IS
  'LP(LP・メルマガ登録系フォームの問合せ。取込専用)。CLAUDE.md §5.17';

CREATE INDEX IF NOT EXISTS idx_lp_entries_member ON public.lp_entries(member_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lp_entries_registered ON public.lp_entries(registered_at DESC NULLS LAST, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lp_entries_email ON public.lp_entries(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lp_entries_form ON public.lp_entries(form_name) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_lp_entries_updated_at ON public.lp_entries;
CREATE TRIGGER trg_lp_entries_updated_at
  BEFORE UPDATE ON public.lp_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.lp_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lp_entries_select ON public.lp_entries;
DROP POLICY IF EXISTS lp_entries_insert ON public.lp_entries;
DROP POLICY IF EXISTS lp_entries_update ON public.lp_entries;
DROP POLICY IF EXISTS lp_entries_delete ON public.lp_entries;
CREATE POLICY lp_entries_select ON public.lp_entries FOR SELECT USING (deleted_at IS NULL);
CREATE POLICY lp_entries_insert ON public.lp_entries FOR INSERT WITH CHECK (public.is_admin());
CREATE POLICY lp_entries_update ON public.lp_entries FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY lp_entries_delete ON public.lp_entries FOR DELETE USING (public.is_admin());

-- オブジェクト管理メタデータ(出金管理 91 の次: 92)
INSERT INTO public.object_definitions (id, label, icon_label, icon_color, sort_order, is_system) VALUES
  ('lp_entries', 'LP', 'LP', '#8b5cf6', 92, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.field_definitions (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system, sort_order_list, sort_order_detail) VALUES
  ('lp_entries', 'id',               '問合せID',     'text',     true,  true, true, 10, 10),
  ('lp_entries', 'registered_at',    '登録日時',     'datetime', true,  true, true, 20, 20),
  ('lp_entries', 'form_name',        'フォーム名',   'text',     true,  true, true, 30, 30),
  ('lp_entries', 'email',            'メールアドレス', 'text',   true,  true, true, 40, 40),
  ('lp_entries', 'name',             '氏名',         'text',     true,  true, true, 50, 50),
  ('lp_entries', 'name_kana',        '氏名かな',     'text',     false, true, true, 60, 60),
  ('lp_entries', 'member_id',        '会員ID',       'text',     true,  true, true, 70, 70),
  ('lp_entries', 'ad_id',            '広告ID',       'text',     true,  true, true, 80, 80),
  ('lp_entries', 'registered_month', '登録月',       'text',     false, true, true, 90, 90)
ON CONFLICT (object_id, field_name) DO NOTHING;

-- メニュー: 問合せ(の次)に「LP」を出す。全ロール表示
INSERT INTO nav_items (id, label, href, match_prefix, sort_order, is_visible, parent_id, visible_roles)
VALUES ('lp', 'LP', '/lp', true, 41, true, NULL, NULL)
ON CONFLICT (id) DO UPDATE
  SET label = excluded.label, href = excluded.href, match_prefix = excluded.match_prefix;

-- 一覧からの一括削除(§5.14 / migration 73)に lp_entries を追加
CREATE OR REPLACE FUNCTION public.soft_delete_records(p_object text, p_ids text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_ids constant integer := 500;
  v_count   integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  IF array_length(p_ids, 1) > v_max_ids THEN
    RAISE EXCEPTION 'too many ids: % (max %)', array_length(p_ids, 1), v_max_ids;
  END IF;

  -- p_object はここで許可済みの値のみに分岐する。
  -- テーブル名を文字列連結して EXECUTE することはしない。
  CASE p_object
    WHEN 'members' THEN
      UPDATE public.members
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    WHEN 'inquiries' THEN
      UPDATE public.inquiries
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    WHEN 'applications' THEN
      UPDATE public.applications
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    WHEN 'article_reactions' THEN
      UPDATE public.article_reactions
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    WHEN 'withdrawal_parents' THEN
      UPDATE public.withdrawal_parents
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    WHEN 'withdrawal_children' THEN
      UPDATE public.withdrawal_children
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    WHEN 'lp_entries' THEN
      UPDATE public.lp_entries
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    ELSE
      RAISE EXCEPTION 'unknown object: %', p_object;
  END CASE;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
