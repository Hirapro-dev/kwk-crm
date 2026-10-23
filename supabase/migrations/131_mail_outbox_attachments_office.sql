-- ============================================================================
-- migration 131: 送信メールの添付に Word・Excel・PowerPoint を加える (2026-10-23)
--                CLAUDE.md §5.15「送信メールの添付」
--
-- 2026-10-23 ユーザー要望: PDF・JPG・PNG に加えて、Word・Excel・PowerPoint(新旧の形式)も送れるようにする。
-- マクロ付き(.docm / .xlsm / .pptm)は送らない。送る前に中身が種類と合うかをサーバーで確かめる(contentMatchesType)。
-- ============================================================================

ALTER TABLE public.mail_outbox_attachments
  DROP CONSTRAINT IF EXISTS mail_outbox_attachments_content_type_check;
ALTER TABLE public.mail_outbox_attachments
  ADD CONSTRAINT mail_outbox_attachments_content_type_check CHECK (content_type IN (
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint'
  ));
