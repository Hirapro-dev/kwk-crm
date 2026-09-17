-- ============================================================================
-- migration 101: メール取込で作った LP のうち CSV 取込分と重複するものを論理削除 (2026-09-17) / CLAUDE.md §5.17
--
-- 内容(ユーザー依頼。2026-09-17 にサービスロールで本番へ適用済み。再実行しても結果は同じ):
--   取込先「LP」のルール(migration 99)で過去のメール(2026-01〜09)から作った LP 2,002 件のうち、
--   CSV 取込分(Salesforce 由来。9/9 分まで)に同じ メール・フォーム名・登録日(日本時間) の行がある 1,176 件を論理削除し、
--   CSV 側(Salesforce の元 ID)を残す。メール側の参照(mail_messages.lp_entry_id)は CSV 側の LP に付け替える。
--   以後の新着はメールからだけ入るため、重複は今回の過去分に限られる。
-- ============================================================================

WITH dup AS (
  SELECT m.id AS mail_lp_id, c.id AS csv_lp_id
    FROM public.lp_entries m
    JOIN LATERAL (
      SELECT c.id
        FROM public.lp_entries c
       WHERE c.source_mail_message_id IS NULL
         AND c.deleted_at IS NULL
         AND lower(coalesce(c.email, '')) = lower(coalesce(m.email, ''))
         AND c.form_name IS NOT DISTINCT FROM m.form_name
         AND (c.registered_at AT TIME ZONE 'Asia/Tokyo')::date = (m.registered_at AT TIME ZONE 'Asia/Tokyo')::date
       ORDER BY c.id
       LIMIT 1
    ) c ON true
   WHERE m.source_mail_message_id IS NOT NULL
     AND m.deleted_at IS NULL
),
relink AS (
  UPDATE public.mail_messages mm
     SET lp_entry_id = d.csv_lp_id,
         import_note = '既存 LP ' || d.csv_lp_id || ' に紐付け(CSV 取込分と重複のため ' || d.mail_lp_id || ' は削除)'
    FROM dup d
   WHERE mm.lp_entry_id = d.mail_lp_id
  RETURNING mm.id
)
UPDATE public.lp_entries l
   SET deleted_at = now()
  FROM dup d
 WHERE l.id = d.mail_lp_id;
