-- ============================================================================
-- 問合せ(inquiries)の登録日時を「日付のみ」表示にする (2026-06)
--
-- 背景: inquiries.registered_at は日付のみのデータを取り込んだため時刻が一律 00:00 UTC
--       (= 09:00 JST)で意味を持たない。一覧/詳細の表示制御(field_definitions)の
--       data_type を datetime → date に変更し、時刻を非表示(日付のみ)にする。
-- ※ DBのカラム型は timestamptz のまま。表示用メタデータのみ変更。
-- ============================================================================

UPDATE public.field_definitions
   SET data_type = 'date', updated_at = now()
 WHERE object_id = 'inquiries' AND field_name = 'registered_at';
