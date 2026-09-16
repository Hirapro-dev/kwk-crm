-- ============================================================================
-- migration 100: ルール 11 で問合せとして作られたメルマガ登録分を LP へ移動 (2026-09-16) / CLAUDE.md §5.16 / §5.17
--
-- 内容(ユーザー依頼。2026-09-16 にサービスロールで本番へ適用済み。再実行しても結果は同じ):
--   メール取込ルール 11「【コーポレートサイト経由】KAWARA版メールマガジン」(取込先: 問合せ)で作られた
--   問合せ 6 件(いずれもメール取込分。会員紐付き・確認済みは無し)を、migration 99 の取込先「LP」に合わせて LP へ移す。
--   1. 同じ TA- ID のまま lp_entries に作成(フォーム名は名称のまま。会員の紐付けはしない)
--   2. mail_messages の処理結果を LP に付け替え(inquiry_id → NULL、lp_entry_id → LP の ID)
--   3. 元の問合せは論理削除(source_mail_message_id は追跡用に残す)
--   ※ 移動前の問合せの値は作業ログとして保存済み
-- ============================================================================

WITH target AS (
  SELECT i.*
    FROM public.inquiries i
    JOIN public.forms f ON f.id = i.form_id
   WHERE f.name = '【コーポレートサイト経由】KAWARA版メールマガジン'
     AND i.source_mail_message_id IS NOT NULL
     AND i.deleted_at IS NULL
),
ins AS (
  INSERT INTO public.lp_entries
    (id, member_id, registered_month, form_name, ad_id, email, name, name_kana, registered_at, source_mail_message_id)
  SELECT id, NULL, to_char(registered_at AT TIME ZONE 'Asia/Tokyo', 'YYYY/MM'),
         '【コーポレートサイト経由】KAWARA版メールマガジン', ad_id, email, name, name_kana, registered_at, source_mail_message_id
    FROM target
  ON CONFLICT (id) DO NOTHING
  RETURNING id
),
mm AS (
  UPDATE public.mail_messages m
     SET inquiry_id = NULL,
         lp_entry_id = t.id,
         import_note = 'LP ' || t.id || ' に移動(元は問合せ。ルール11→LP)'
    FROM target t
   WHERE m.message_id = t.source_mail_message_id
  RETURNING m.id
)
UPDATE public.inquiries i
   SET deleted_at = now()
  FROM target t
 WHERE i.id = t.id;
