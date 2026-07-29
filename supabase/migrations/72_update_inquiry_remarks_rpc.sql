-- ============================================================================
-- migration 72: 問合せ「備考」の全ロール更新 RPC (2026-07)
--
-- 背景:
--   問合せ詳細の「備考」(extra jsonb 内のキー、CSV由来) も会員の備考 (migration 71)
--   と同様に、全ロールが画面からインライン編集できるようにしたい。
--   inquiries_update ポリシーは can_write() のみ許可のため viewer が編集できず、
--   また extra jsonb の部分更新は jsonb_set を使う RPC の方が安全なため関数化する。
--
-- 対応:
--   extra->'備考' のみを更新する SECURITY DEFINER 関数を用意し、authenticated 全員に
--   許可する (update_member_remarks / migration 71 と同方式)。
--   空文字で保存した場合はキー自体を削除する。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_inquiry_remarks(p_inquiry_id text, p_remarks text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  UPDATE public.inquiries
    SET extra = CASE
          WHEN btrim(coalesce(p_remarks, '')) = ''
            THEN coalesce(extra, '{}'::jsonb) - '備考'
          ELSE jsonb_set(coalesce(extra, '{}'::jsonb), '{備考}', to_jsonb(p_remarks))
        END,
        updated_at = now()
    WHERE id = p_inquiry_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inquiry not found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_inquiry_remarks(text, text) TO authenticated;
