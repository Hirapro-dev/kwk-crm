-- ============================================================================
-- migration 85: 過去データ取込メッセージの宛先(To)補正用 RPC (2026-09-14)
--               CLAUDE.md §5.15
--
-- 背景:
--   メールディーラーからの過去データ取込(scripts/mail/import_maildealer.ts)は、宛先(To)を
--   CSV の「Toアドレス」列(受信箱のアドレス1つ)から取り、ヘッダーの To 行(複数宛先)を
--   見ていなかった。そのため、フォーム通知に同送されていた旧「メール to リード」用
--   アドレス(y3awtd-hirayama-p@hdbronze.htdb.jp)が落ち、過去分が「取込候補」にならなかった
--   (2026-09-14 に判明。CSV のヘッダー To 行には残っていることを確認済み)。
--
-- 対応:
--   補正スクリプト(scripts/mail/repair_maildealer_recipients.ts)が CSV のヘッダーから
--   全宛先を読み直し、message_id で突合して to_addresses を置き換える。あわせて、
--   宛先に取込候補の判定アドレスを含むスレッドに is_import_candidate を立てる。
--   本文などは触らない。何度実行しても同じ結果(冪等)。
--   配列を POST body で渡すため RPC にする(migration 80/81 と同じ理由)。
--   権限チェックは持たないため authenticated からは呼べない(サービスロール専用)。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.repair_mail_message_recipients(
  p_rows jsonb,
  p_candidate_addresses text[]
)
RETURNS TABLE (updated_messages integer, flagged_threads integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
  v_flagged integer;
BEGIN
  -- 1) 宛先の置き換え(過去データ取込分のみ。内容が同じ行は触らない)
  UPDATE public.mail_messages m
  SET to_addresses = r.to_addresses
  FROM jsonb_to_recordset(p_rows) AS r(message_id text, to_addresses text[])
  WHERE m.message_id = r.message_id
    AND m.source = 'import_maildealer'
    AND m.to_addresses IS DISTINCT FROM r.to_addresses;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- 2) 補正後の宛先に判定アドレスを含むスレッドを「取込候補」にする(migration 82 と同じ判定)
  UPDATE public.mail_threads t
  SET is_import_candidate = true
  FROM (
    SELECT DISTINCT m.thread_id
    FROM public.mail_messages m
    JOIN jsonb_to_recordset(p_rows) AS r(message_id text) ON r.message_id = m.message_id
    WHERE m.to_addresses && p_candidate_addresses
       OR m.cc_addresses && p_candidate_addresses
  ) c
  WHERE t.id = c.thread_id
    AND NOT t.is_import_candidate;
  GET DIAGNOSTICS v_flagged = ROW_COUNT;

  RETURN QUERY SELECT v_updated, v_flagged;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_mail_message_recipients(jsonb, text[])
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.repair_mail_message_recipients(jsonb, text[]) IS
  '過去データ取込メッセージの宛先(To)を message_id で突合して置き換え、判定アドレスを含む
   スレッドを取込候補にする。サービスロール専用。CLAUDE.md §5.15';
