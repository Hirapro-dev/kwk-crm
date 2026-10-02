-- ============================================================================
-- migration 121: 申込に「利息種別」を追加する (2026-10-02)
--                CLAUDE.md §5.6 / §8.1 /applications
--
-- 背景(ユーザー要望):
--   申込の新規登録で、利息(%)の前に「利息種別」(月利 / 年利 / 契約期間内)をプルダウンで選びたい。
--   利息(interest)が何の期間あたりの率かを表す。申込オブジェクトの項目としても持つ。
--
-- 方針:
--   - interest_type text(NULL 可)を追加し、値は 3 つに CHECK で限定する(ステータス・区分と同じ考え方)。
--   - field_definitions に登録し、オブジェクト管理で一覧/詳細の表示を切り替えられるようにする
--     (初期値は一覧 非表示 / 詳細 表示。並びは利息の直前)。
--   - 既存の申込は NULL(未設定)のまま。CSV 取込の対象外。
-- ============================================================================

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS interest_type text;

ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_interest_type_check;
ALTER TABLE public.applications
  ADD CONSTRAINT applications_interest_type_check
  CHECK (interest_type IS NULL OR interest_type IN ('月利', '年利', '契約期間内'));

COMMENT ON COLUMN public.applications.interest_type IS
  '利息種別(月利 / 年利 / 契約期間内)。利息 interest が何の期間あたりの率か。migration 121';

-- 詳細の並び: 利息(interest)と同じ区画で、その直前に置く
INSERT INTO public.field_definitions
  (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system,
   sort_order_list, sort_order_detail, is_in_db, section_name, description)
SELECT 'applications', 'interest_type', '利息種別', 'enum', false, true, true,
       COALESCE(i.sort_order_list, 265) - 1, COALESCE(i.sort_order_detail, 255) - 1, true, i.section_name,
       '利息(%)がどの期間あたりの率か(月利 / 年利 / 契約期間内)。2026-10-02 追加(migration 121)'
  FROM (SELECT 1) AS one
  LEFT JOIN public.field_definitions i ON i.object_id = 'applications' AND i.field_name = 'interest'
-- 再適用時に表示ON/OFF・並び順を上書きしない(migration 107 と同じ)
ON CONFLICT (object_id, field_name) DO UPDATE
  SET label       = EXCLUDED.label,
      data_type   = EXCLUDED.data_type,
      is_in_db    = EXCLUDED.is_in_db,
      is_system   = EXCLUDED.is_system,
      description = EXCLUDED.description,
      updated_at  = now();
