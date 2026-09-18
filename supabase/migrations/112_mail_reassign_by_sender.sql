-- ============================================================================
-- migration 112: 送信メールのスレッドを差出人(From)の受信箱へ再振り分けする (2026-09-18)
--                CLAUDE.md §5.15「その他(未登録アドレス宛)」
--
-- 背景:
--   メールディーラー取込と「その他」の再振り分けは、受信箱を宛先(To/Cc/転送ヘッダ)だけで決めていた。
--   送信メール(方向 out)は宛先が顧客なので受信箱に一致せず、差出人が自社アドレスでも「その他」に入っていた
--   (エクスポート B の取込後に残った約 19.8 万スレッドの大半。サンプルの 94% が送信メール)。
--
-- 方針:
--   - 「その他」のスレッドのうち、送信メッセージの差出人(小文字)が有効な受信箱のアドレスに一意に一致するものを
--     その受信箱へ移す(複数の受信箱に一致するスレッドは動かさない。migration 83 と同じ考え方)。
--   - last_message_at の範囲指定で分けて呼ぶ(全件 1 回だと statement_timeout に掛かるため)。
--   - 権限チェック無し。authenticated からは呼べない(SQL Editor / サービスロール専用)。
--   - 取込スクリプト側も、送信メールは差出人で受信箱を決めるよう修正(今後の取込では発生しない)。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reassign_other_mail_threads_by_sender_range(
  p_from timestamptz DEFAULT NULL,
  p_to   timestamptz DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_other_id integer;
  v_moved    integer;
BEGIN
  SELECT id INTO v_other_id FROM public.mail_boxes WHERE address = 'other@unassigned.invalid';
  IF v_other_id IS NULL THEN
    RETURN 0;
  END IF;

  WITH candidates AS (
    SELECT m.thread_id, b.id AS box_id
    FROM public.mail_threads t
    JOIN public.mail_messages m ON m.thread_id = t.id AND m.direction = 'out'
    JOIN public.mail_boxes b ON lower(b.address) = lower(m.from_address)
    WHERE t.mail_box_id = v_other_id
      AND t.deleted_at IS NULL
      AND (p_from IS NULL OR t.last_message_at >= p_from)
      AND (p_to   IS NULL OR t.last_message_at <  p_to)
      AND b.id <> v_other_id
      AND b.is_active
    GROUP BY m.thread_id, b.id
  ),
  resolved AS (
    SELECT thread_id, min(box_id) AS box_id
    FROM candidates
    GROUP BY thread_id
    HAVING count(*) = 1
  )
  UPDATE public.mail_threads t
  SET mail_box_id = r.box_id, updated_at = now()
  FROM resolved r
  WHERE t.id = r.thread_id;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_other_mail_threads_by_sender_range(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.reassign_other_mail_threads_by_sender_range(timestamptz, timestamptz) IS
  '「その他」のスレッドのうち送信メッセージの差出人が一意に一致する受信箱へ移す(last_message_at の範囲指定可)。
   権限チェック無しのため authenticated からは呼べない。CLAUDE.md §5.15';
