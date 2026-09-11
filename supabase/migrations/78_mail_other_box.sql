-- ============================================================================
-- migration 78: 未登録アドレス宛メールの「その他」フォルダと再振り分け (2026-09)
--
-- 背景:
--   共有アドレスは順次 mail_boxes に登録していく運用のため、まだ登録していない
--   アドレス宛のメールが SES 経由・過去データ取込の両方で発生する。これまで
--   Webhook はそのまま無視して捨てていたが、共有アドレス数が数百件に及ぶため
--   取りこぼしに気づけない。登録前でも一時的に受け止めておき、後からそのアドレスを
--   登録したら正しい受信箱へ移せるようにする(CLAUDE.md §5.15)。
--
-- 対応:
--   1. 予約の受信箱を1行追加する。address は実在しないドメイン(.invalid, RFC 2606)を
--      使い、本物の共有アドレスと絶対に衝突しないようにする(転送されてくることも無く、
--      SES でドメイン検証されることも無いため常に「受信専用」)。
--   2. reassign_other_mail_threads(): 「その他」に入っているスレッドのうち、直近の
--      メッセージの元の宛先(to_addresses / cc_addresses)が、現在有効な受信箱の
--      アドレスと完全一致(大文字小文字は無視)するスレッドを、その受信箱へ移す。
--      一致する受信箱が複数(=どちらか決められない)ときは動かさない
--      (§5.15 の「あいまい一致はしない」方針と同じ)。
--
-- コード側(本ファイルの対象外):
--   - app/api/mail/inbound/route.ts: 通常の受信箱に一致しなければこの「その他」に入れる
--   - 過去データ取込スクリプト: 同上
--   - lib/domain/mail_box_actions.ts の createMailBox: 登録直後にこの関数を呼び、
--     「その他」に溜まっていたメールがあれば自動で振り分ける
--   - /mail/settings に手動実行用の「再振り分け」ボタンを追加
-- ============================================================================

INSERT INTO public.mail_boxes (address, display_name, is_active)
VALUES ('other@unassigned.invalid', 'その他(未登録アドレス宛)', true)
ON CONFLICT (address) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reassign_other_mail_threads()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_other_id integer;
  v_moved    integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  SELECT id INTO v_other_id FROM public.mail_boxes WHERE address = 'other@unassigned.invalid';
  IF v_other_id IS NULL THEN
    RETURN 0;
  END IF;

  WITH candidates AS (
    SELECT t.id AS thread_id, b.id AS box_id
    FROM public.mail_threads t
    JOIN public.mail_messages m ON m.thread_id = t.id
    JOIN public.mail_boxes b
      ON lower(b.address) = ANY (
        SELECT lower(a) FROM unnest(m.to_addresses || m.cc_addresses) AS a
      )
    WHERE t.mail_box_id = v_other_id
      AND t.deleted_at IS NULL
      AND b.id <> v_other_id
      AND b.is_active
    GROUP BY t.id, b.id
  ),
  resolved AS (
    SELECT thread_id, min(box_id) AS box_id
    FROM candidates
    GROUP BY thread_id
    HAVING count(DISTINCT box_id) = 1
  )
  UPDATE public.mail_threads t
  SET mail_box_id = r.box_id, updated_at = now()
  FROM resolved r
  WHERE t.id = r.thread_id;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END;
$$;

COMMENT ON FUNCTION public.reassign_other_mail_threads() IS
  '「その他」の受信箱にあるスレッドのうち、宛先アドレスが現在有効な受信箱のアドレスと
   一意に一致するものをその受信箱へ移す。admin のみ実行可。CLAUDE.md §5.15';

GRANT EXECUTE ON FUNCTION public.reassign_other_mail_threads() TO authenticated;
