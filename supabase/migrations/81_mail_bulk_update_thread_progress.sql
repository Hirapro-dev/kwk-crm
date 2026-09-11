-- ============================================================================
-- migration 81: 過去データ取込(scripts/mail/import_maildealer.ts)用の
-- 既存スレッド一括更新 RPC (2026-09)
--
-- 背景:
--   取込スクリプトは、ファイル内で新規メッセージが追加された既存スレッドの
--   status / member_id / last_message_at / last_direction を更新するが、
--   これまでは対象スレッドごとに個別の UPDATE リクエストを1件ずつ送っていた。
--   68ファイル・約82万行の本実行では、既存スレッドへの追記が数万件規模になり、
--   1件ずつのリクエストが処理時間の大半を占める見込みだったため、まとめて
--   1回の UPDATE で処理できる RPC に置き換える(migration 79/80 と同じ方針)。
--
-- 対応:
--   更新内容の配列を JSON で受け取り、jsonb_to_recordset() で展開して
--   1本の UPDATE ... FROM で一括反映する。SET 句に無い列(subject 等)には
--   一切触れない(通常の UPDATE 文なので、INSERT の NOT NULL 制約は関係しない)。
--   SECURITY INVOKER(既定)。RLS(migration 76: INSERT・UPDATE は viewer 以外)が
--   そのまま効く。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.bulk_update_mail_thread_progress(p_updates jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.mail_threads AS t
  SET
    status = u.status,
    member_id = u.member_id,
    last_message_at = u.last_message_at,
    last_direction = u.last_direction
  FROM jsonb_to_recordset(p_updates) AS u(
    id uuid,
    status text,
    member_id text,
    last_message_at timestamptz,
    last_direction text
  )
  WHERE t.id = u.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.bulk_update_mail_thread_progress(jsonb) IS
  '過去データ取込用: 既存スレッドの status/member_id/last_message_at/last_direction を
   1回のUPDATEでまとめて反映する(1件ずつのUPDATEを避けるため)。CLAUDE.md §5.15';

GRANT EXECUTE ON FUNCTION public.bulk_update_mail_thread_progress(jsonb) TO authenticated;
