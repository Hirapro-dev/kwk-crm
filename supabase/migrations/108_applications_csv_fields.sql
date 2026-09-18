-- ============================================================================
-- migration 108: 申込に Salesforce の申込一覧 CSV(2026-09-18 形式)にある項目を追加する (2026-09-18)
--                CLAUDE.md §5.6 / §6
--
-- 背景:
--   Salesforce の「申込情報：申込一覧」CSV(26 列)を CRM と突き合わせたところ、
--   列が無い項目が 資金移動元 / ｷｬﾝﾍﾟｰﾝ対象金額 / 会員情報DB反映、状態の値 「失効」(15 件)が未対応だった
--   (利息・契約期日は migration 107 で追加済み)。
--
-- 方針:
--   - transfer_from text(資金移動元。資金移動先 transfer_to とは別の値。CSV と DB を比較して 0 件一致 = 別項目と確認)
--   - campaign_target_amount numeric(18,2)(ｷｬﾝﾍﾟｰﾝ対象金額)
--   - status の CHECK に「失効」を追加(CSV の値。取込時に弾かれて NULL になるのを防ぐ)
--   - 会員情報DB反映(値は「済」のみ)は extra(取込時に自動登録)で持ち、列は作らない
--   - field_definitions に登録(migration 75 と同方式。初期値は一覧 非表示 / 詳細 表示)
--   - migration 107 の interest(利息)の説明を「数値(単位は Salesforce の列のまま)」に直す
-- ============================================================================

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS transfer_from text,
  ADD COLUMN IF NOT EXISTS campaign_target_amount numeric(18,2);
COMMENT ON COLUMN public.applications.transfer_from IS '資金移動元(CSV「資金移動元」。資金移動先 transfer_to とは別)。migration 108';
COMMENT ON COLUMN public.applications.campaign_target_amount IS 'ｷｬﾝﾍﾟｰﾝ対象金額(CSV「ｷｬﾝﾍﾟｰﾝ対象金額」)。migration 108';
COMMENT ON COLUMN public.applications.interest IS '利息(CSV「利息」。数値。単位は Salesforce の列のまま。円金利 yen_interest とは別)。migration 107/108';

-- 状態に「失効」を追加(01_schema の inline CHECK は applications_status_check という名前で作られている)
ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE public.applications
  ADD CONSTRAINT applications_status_check
  CHECK (status IN ('対応中', '未購入', '完了', '出金', '資金移動', '失効'));

INSERT INTO public.field_definitions
  (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system,
   sort_order_list, sort_order_detail, is_in_db, description, csv_column_name)
VALUES
  ('applications', 'transfer_from', '資金移動元', 'text', false, true, true, 435, 155, true,
   '資金移動元(資金移動先とは別)。2026-09-18 追加(migration 108)', '資金移動元'),
  ('applications', 'campaign_target_amount', 'ｷｬﾝﾍﾟｰﾝ対象金額', 'number', false, true, true, 655, 285, true,
   'ｷｬﾝﾍﾟｰﾝ対象金額。2026-09-18 追加(migration 108)', 'ｷｬﾝﾍﾟｰﾝ対象金額')
ON CONFLICT (object_id, field_name) DO UPDATE
  SET label           = EXCLUDED.label,
      data_type       = EXCLUDED.data_type,
      is_in_db        = EXCLUDED.is_in_db,
      is_system       = EXCLUDED.is_system,
      description     = EXCLUDED.description,
      csv_column_name = EXCLUDED.csv_column_name,
      updated_at      = now();

-- migration 107 で追加した 2 列にも CSV 列名を付ける(項目管理の表示用)
UPDATE public.field_definitions SET csv_column_name = '利息', updated_at = now()
  WHERE object_id = 'applications' AND field_name = 'interest' AND csv_column_name IS NULL;
UPDATE public.field_definitions SET csv_column_name = '契約期日', updated_at = now()
  WHERE object_id = 'applications' AND field_name = 'contract_end_date' AND csv_column_name IS NULL;
