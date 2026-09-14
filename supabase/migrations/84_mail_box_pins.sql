-- ============================================================================
-- migration 84: 受信箱のピン留め(ユーザーごと) (2026-09-14) / CLAUDE.md §5.15
--
-- 背景:
--   受信箱が数百件(migration 83)になり、担当者が自分の確認すべきフォルダを
--   探しにくい。各ユーザーが受信箱をピン留めして、左フォルダの上部にまとめて
--   出せるようにする。
--
-- 方針:
--   - 端末に依らず同じピン留めを出すため DB に持つ(ブラウザ保存にしない)。
--   - 1行 = 1ユーザー × 1受信箱。並びはピン留めした順(created_at)。
--   - RLS: 自分の行だけ読み書きできる(管理者も他人のピン留めは触らない)。
--   - 受信箱・ユーザーが消えた場合は行も消す(ON DELETE CASCADE)。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mail_box_pins (
  user_id     uuid        NOT NULL REFERENCES public.users(id)      ON DELETE CASCADE,
  mail_box_id integer     NOT NULL REFERENCES public.mail_boxes(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mail_box_id)
);

COMMENT ON TABLE public.mail_box_pins IS
  '受信箱のピン留め(ユーザーごと)。左フォルダ上部の「ピン留め」区画に出す。CLAUDE.md §5.15';

ALTER TABLE public.mail_box_pins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mail_box_pins_own ON public.mail_box_pins;
CREATE POLICY mail_box_pins_own ON public.mail_box_pins
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
