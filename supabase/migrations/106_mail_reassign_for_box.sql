-- ============================================================================
-- migration 106: 受信箱登録時の「その他」再振り分けを受信箱単位で高速に行う (2026-09-18)
--                CLAUDE.md §5.15「その他(未登録アドレス宛)」
--
-- 背景:
--   受信箱を追加したときの自動再振り分け(reassign_other_mail_threads → _range(NULL, NULL))は
--   「その他」の全スレッド(約 6.1 万件)の宛先を毎回展開するため約 18 秒かかり、PostgREST の
--   statement_timeout(8 秒)で止まっていた。アプリ側は best-effort で失敗を握りつぶすため、
--   登録前に届いたメールが「その他」に残ったままになる(2026-09-18 に support@ / ueda@ で発覚)。
--
-- 対処:
--   1) 宛先(To/Cc)の GIN インデックス(小文字化した配列)を mail_messages に張る
--   2) 受信箱 1 件を対象にした reassign_other_mail_threads_for_box(p_box_id) を追加し、
--      受信箱の追加時はこれを呼ぶ(そのアドレス宛のメッセージだけをインデックスで引く)
--   3) 設定画面の「再振り分けを実行」は既存の _range を期間ごとに分けて呼ぶ(アプリ側)
--   判定(宛先が有効な受信箱と一意に一致するスレッドだけ移す)は従来と同じ。
--
-- 注意: インデックス作成中(数十秒〜1 分程度)は mail_messages への書込みが待たされる。
--       受信 Webhook は SNS が再送するため取りこぼしはしないが、静かな時間帯の実行を推奨。
-- ============================================================================

-- 1) 宛先配列を小文字化する不変関数(式インデックス用。保存時に小文字化しているが表記ゆれに備える)
CREATE OR REPLACE FUNCTION public.lower_text_array(p text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(array_agg(lower(x)), ARRAY[]::text[]) FROM unnest(p) AS x
$$;

CREATE INDEX IF NOT EXISTS idx_mail_messages_to_lower_gin
  ON public.mail_messages USING gin (public.lower_text_array(to_addresses));
CREATE INDEX IF NOT EXISTS idx_mail_messages_cc_lower_gin
  ON public.mail_messages USING gin (public.lower_text_array(cc_addresses));

-- 2) 受信箱 1 件分の再振り分け(admin のみ)。
--    そのアドレス宛のメッセージを持つ「その他」のスレッドのうち、宛先が有効な受信箱と
--    一意に一致するもの(= 他の受信箱にも一致するスレッドは動かさない)をその受信箱へ移す。
CREATE OR REPLACE FUNCTION public.reassign_other_mail_threads_for_box(p_box_id integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_other_id integer;
  v_addr     text;
  v_moved    integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  SELECT id INTO v_other_id FROM public.mail_boxes WHERE address = 'other@unassigned.invalid';
  SELECT lower(address) INTO v_addr FROM public.mail_boxes WHERE id = p_box_id AND is_active;
  IF v_other_id IS NULL OR v_addr IS NULL OR p_box_id = v_other_id THEN
    RETURN 0;
  END IF;

  WITH hit AS (
    -- このアドレス宛のメッセージを持つ「その他」のスレッド(GIN インデックスで引く)
    SELECT DISTINCT m.thread_id
    FROM public.mail_messages m
    JOIN public.mail_threads t ON t.id = m.thread_id
    WHERE (public.lower_text_array(m.to_addresses) @> ARRAY[v_addr]
        OR public.lower_text_array(m.cc_addresses) @> ARRAY[v_addr])
      AND t.mail_box_id = v_other_id
      AND t.deleted_at IS NULL
  ),
  candidates AS (
    -- そのスレッドの全メッセージの宛先が一致する有効な受信箱(一意性の判定用)
    SELECT m.thread_id, b.id AS box_id
    FROM hit h
    JOIN public.mail_messages m ON m.thread_id = h.thread_id
    CROSS JOIN LATERAL unnest(m.to_addresses || m.cc_addresses) AS a
    JOIN public.mail_boxes b ON lower(b.address) = lower(a)
    WHERE b.id <> v_other_id
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

COMMENT ON FUNCTION public.reassign_other_mail_threads_for_box(integer) IS
  '受信箱 1 件を対象に「その他」のスレッドを再振り分けする(受信箱の追加時に呼ぶ)。admin のみ。CLAUDE.md §5.15';

GRANT EXECUTE ON FUNCTION public.reassign_other_mail_threads_for_box(integer) TO authenticated;
