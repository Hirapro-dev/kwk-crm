-- ============================================================================
-- migration 88: メール取込の自動作成(段階③) (2026-09-15) / CLAUDE.md §5.16
--
-- 内容:
--   1. inquiries に元メールの識別子(source_mail_message_id。1メール1件の冪等キー)と
--      会員の自動照合結果(member_match jsonb)を追加
--   2. mail_messages に処理結果(import_status / import_note / inquiry_id)を追加
--      (取込候補の一覧・メール詳細で「処理結果」として表示する)
--   3. 問合せIDの採番 gen_inquiry_id(): TA- 形式(9桁ゼロ埋め)。
--      既存の gen_ta_id()(migration 03)は 7 桁形式で、実データ(TA-000475044 等 9 桁)に
--      合わないため使わない。連番は 1000000(TA-001000000)から。Salesforce 併用中は
--      Salesforce も 47 万台の TA- を振り続ける(2026-09-15 時点の最大 TA-000475044)ため、
--      離れた番号帯にして CSV 取込時の衝突を避ける(会員IDの K-000100000 と同じ考え方)。
--   4. 会員の自動照合 match_members_for_inquiry(): 氏名・電話・メール・住所の4点を
--      正規化して比較し、一致点数を返す。判定(3点以上で自動紐付け等)はアプリ側の
--      純粋関数 decideMemberMatch() が行う。正規化の規則はアプリ側 normalizeMatchInput() と
--      同じ(氏名・住所 = NFKC → 空白除去 → 小文字 / 電話 = 数字のみ → 先頭0除去 / メール = 小文字)。
-- ============================================================================

-- 1) inquiries
ALTER TABLE public.inquiries
  ADD COLUMN IF NOT EXISTS source_mail_message_id text,
  ADD COLUMN IF NOT EXISTS member_match jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inquiries_source_mail_message_id
  ON public.inquiries(source_mail_message_id)
  WHERE source_mail_message_id IS NOT NULL;

COMMENT ON COLUMN public.inquiries.source_mail_message_id IS
  'メール取込(§5.16)で作った問合せの元メール(mail_messages.message_id)。1メール1件の冪等キー';
COMMENT ON COLUMN public.inquiries.member_match IS
  '会員の自動照合結果 {"status":"auto"|"candidates"|"none"|"manual","points":n,"candidates":[...],"checked_at":...}';

-- 2) mail_messages
ALTER TABLE public.mail_messages
  ADD COLUMN IF NOT EXISTS import_status text
    CHECK (import_status IN ('pending', 'done', 'error')),
  ADD COLUMN IF NOT EXISTS import_note text,
  ADD COLUMN IF NOT EXISTS inquiry_id text REFERENCES public.inquiries(id);

COMMENT ON COLUMN public.mail_messages.import_status IS
  '取込候補の処理結果: pending=ルール未一致 / done=作成済み・既存に紐付け / error=エラー。候補以外は NULL';

-- 3) 問合せIDの採番(TA- 形式 9 桁)
CREATE SEQUENCE IF NOT EXISTS public.inquiries_id_seq
  AS bigint
  START WITH 1000000
  MINVALUE 1000000
  NO CYCLE;

CREATE OR REPLACE FUNCTION public.gen_inquiry_id()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT 'TA-' || lpad(nextval('public.inquiries_id_seq')::text, 9, '0');
$$;

COMMENT ON FUNCTION public.gen_inquiry_id() IS
  '新規問合せIDを TA- 形式(9桁ゼロ埋め)で採番する。TA-001000000 から。CLAUDE.md §5.16';

GRANT USAGE ON SEQUENCE public.inquiries_id_seq TO authenticated;
GRANT EXECUTE ON FUNCTION public.gen_inquiry_id() TO authenticated;

-- 4) 会員の自動照合(一致点数を返す。判定はアプリ側)
CREATE OR REPLACE FUNCTION public.match_members_for_inquiry(
  p_name text,
  p_phone text,
  p_email text,
  p_address text
)
RETURNS TABLE (member_id text, points integer, matched text[])
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH q AS (
    SELECT nullif(p_name, '') AS name,
           nullif(p_phone, '') AS phone,
           nullif(p_email, '') AS email,
           nullif(p_address, '') AS address
  ),
  scored AS (
    SELECT m.id AS member_id,
      (q.name IS NOT NULL
        AND lower(regexp_replace(normalize(coalesce(m.name, ''), NFKC), '\s', '', 'g')) = q.name) AS name_ok,
      (q.phone IS NOT NULL
        AND regexp_replace(regexp_replace(coalesce(m.phone1, ''), '\D', '', 'g'), '^0+', '') = q.phone) AS phone_ok,
      (q.email IS NOT NULL
        AND q.email IN (lower(trim(coalesce(m.email1, ''))), lower(trim(coalesce(m.email2, ''))), lower(trim(coalesce(m.email3, ''))))) AS email_ok,
      (q.address IS NOT NULL
        AND lower(regexp_replace(normalize(coalesce(m.address, ''), NFKC), '\s', '', 'g')) = q.address) AS address_ok
    FROM public.members m, q
    WHERE m.deleted_at IS NULL
  )
  SELECT s.member_id,
         (s.name_ok::int + s.phone_ok::int + s.email_ok::int + s.address_ok::int) AS points,
         array_remove(ARRAY[
           CASE WHEN s.name_ok THEN 'name' END,
           CASE WHEN s.phone_ok THEN 'phone' END,
           CASE WHEN s.email_ok THEN 'email' END,
           CASE WHEN s.address_ok THEN 'address' END
         ], NULL) AS matched
  FROM scored s
  WHERE s.name_ok OR s.phone_ok OR s.email_ok OR s.address_ok
  ORDER BY points DESC, s.member_id
  LIMIT 20;
$$;

COMMENT ON FUNCTION public.match_members_for_inquiry(text, text, text, text) IS
  'メール取込の会員自動照合: 正規化した氏名・電話・メール・住所と一致する会員と点数(0〜4)を返す。CLAUDE.md §5.16';

GRANT EXECUTE ON FUNCTION public.match_members_for_inquiry(text, text, text, text) TO authenticated;
