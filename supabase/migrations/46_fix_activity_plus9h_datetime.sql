-- ============================================================================
-- 対応歴の +9時間ずれ(JST修正前に作成された行)を補正 (2026-06)
--
-- 背景: JST修正(commit 3c1eeab)以前にフォームから作成された対応歴は、
--       datetime-local(JST壁時計)を UTC として保存したため registered_datetime が
--       +9時間ずれている(作成時刻より9時間"未来"=過去ログとしてあり得ない値)。
--       この影響で新規作成した正しい時刻の対応歴が一覧の下に埋もれて見えなくなる。
--
-- 対象: registered_datetime が created_at の 8〜10時間"後"にある行(=+9hバグの署名)。
--       取込データは registered_datetime が過去(created_atより前)のため対象外。
-- 補正: registered_datetime を -9時間、registered_date を JST 日付で再計算。
-- ============================================================================

UPDATE public.activities
   SET registered_datetime = registered_datetime - interval '9 hours',
       registered_date = ((registered_datetime - interval '9 hours') AT TIME ZONE 'Asia/Tokyo')::date,
       updated_at = now()
 WHERE deleted_at IS NULL
   AND registered_datetime BETWEEN created_at + interval '8 hours'
                               AND created_at + interval '10 hours';
