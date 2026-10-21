-- ============================================================================
-- migration 128: メーラーの送信メールの添付(mail_outbox_attachments) (2026-10-21)
--                CLAUDE.md §5.15「送信メールの添付」
--
-- 目的:
--   メーラーの返信・新規作成で PDF / JPG / PNG を添付できるようにする。画像は本文の欄にドラッグ&ドロップ(貼り付け)すると
--   本文のその位置に表示する(HTML メールの cid 参照)。2026-10-21 ユーザー決定:
--   種類は PDF・JPG・PNG のみ / 1 通の合計 15MB まで(1 ファイル 10MB・10 ファイルまで)/ 本文中の画像はその位置に表示。
--
-- 方針:
--   - 送信は承認の後なので、添付は送信待ちメール(mail_outbox)に紐付けて持つ。実体は既存の非公開バケット mail-attachments
--     (受信メールの添付と同じ)。画面から Storage へ直接アップロードし(サーバーが権限を確認して発行した一時的なアップロード URL を使う。
--     Vercel の 1 リクエスト約 4.5MB の上限を避けるため)、承認依頼のときにこの表へ登録する。
--   - content_id がある行は本文中の画像(HTML の <img src="cid:…">)。NULL は通常の添付。
--   - 送信したら mail_attachments にも同じ実体(storage_path)で登録し、スレッドの画面に添付として出す。
--   - RLS: SELECT は全ロール(mail_outbox と同じ)。書込みポリシーは設けない(Server Action がサービスロールで書く)。
--   - 物理削除はしない(送信待ちメール自体も消さない)。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mail_outbox_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id     uuid NOT NULL REFERENCES public.mail_outbox(id),
  filename      text NOT NULL,                                        -- 元のファイル名(相手に見える名前)
  content_type  text NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes    bigint NOT NULL CHECK (size_bytes > 0),
  storage_path  text NOT NULL,                                        -- バケット mail-attachments 内のキー
  content_id    text,                                                 -- 本文中の画像の cid(NULL = 通常の添付)
  sort_order    int NOT NULL DEFAULT 0,
  created_by    uuid NOT NULL REFERENCES public.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.mail_outbox_attachments IS '送信待ちメールの添付(PDF / JPG / PNG)。content_id があれば本文中の画像。CLAUDE.md §5.15';

CREATE INDEX IF NOT EXISTS idx_mail_outbox_attachments_outbox
  ON public.mail_outbox_attachments (outbox_id, sort_order);

ALTER TABLE public.mail_outbox_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mail_outbox_attachments_select ON public.mail_outbox_attachments;
CREATE POLICY mail_outbox_attachments_select ON public.mail_outbox_attachments
  FOR SELECT TO authenticated USING (true);
