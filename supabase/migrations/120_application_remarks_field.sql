-- 120: 申込の「備考」(extra のキー)を項目管理に登録する(2026-10-01)
-- 申込の新規登録に備考の入力欄を追加した(extra.備考 に保存)。詳細画面に表示し、編集ダイアログでも直せるようにする。
-- 本番へはサービスロールで適用済み(このファイルは記録用。再実行しても増えない)。
INSERT INTO public.field_definitions
  (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system, is_custom, is_in_db, section_name, sort_order_list, sort_order_detail)
VALUES
  ('applications', '備考', '備考', 'text', false, true, false, false, false, '基本情報', 100010, 158)
ON CONFLICT (object_id, field_name) DO NOTHING;
