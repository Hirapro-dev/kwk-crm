-- ============================================================================
-- migration 105: メーラーの署名マスタ(mail_signatures)と受信箱の既定署名 (2026-09-18)
--                CLAUDE.md §5.15「署名」/ §8.1 /mail/settings
--
-- 目的:
--   署名を受信箱ごとの 1 列(mail_boxes.signature)ではなく、名前を付けた「署名」として
--   別に管理し、各受信箱には「既定でどの署名を使うか」だけを持たせる。
--   同じ署名を複数の受信箱で使い回せ、返信・新規作成フォームでは署名名で選べる。
--
-- 方針(マスタ管理 migration 96 と同じ):
--   - 物理削除はせず is_active で無効化。created_at/updated_at + set_updated_at トリガー。
--   - RLS: SELECT は全ロール(返信フォームで使う)、書込は admin のみ。
--   - 既存の mail_boxes.signature は署名マスタへ写して既定署名に紐付ける(本文が同じものは 1 件にまとめる)。
--     旧列は当面残す(取り込み中のデプロイ順の都合。コードからは参照しない)。
-- ============================================================================

-- 1) 署名マスタ
CREATE TABLE IF NOT EXISTS public.mail_signatures (
  id          serial PRIMARY KEY,
  name        text NOT NULL,                    -- 署名名(選択肢の表示名)
  body        text NOT NULL,                    -- 署名本文(複数行)
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.mail_signatures IS 'メーラーの署名マスタ(名前 + 本文)。CLAUDE.md §5.15';

DROP TRIGGER IF EXISTS trg_mail_signatures_updated_at ON public.mail_signatures;
CREATE TRIGGER trg_mail_signatures_updated_at
  BEFORE UPDATE ON public.mail_signatures
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.mail_signatures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mail_signatures_select ON public.mail_signatures;
DROP POLICY IF EXISTS mail_signatures_write  ON public.mail_signatures;
CREATE POLICY mail_signatures_select ON public.mail_signatures FOR SELECT USING (true);
CREATE POLICY mail_signatures_write  ON public.mail_signatures FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 2) 受信箱の既定署名(署名を無効化しても参照は残す。物理削除時は NULL に戻す)
ALTER TABLE public.mail_boxes
  ADD COLUMN IF NOT EXISTS default_signature_id integer REFERENCES public.mail_signatures(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.mail_boxes.default_signature_id IS '既定の署名(mail_signatures)。返信・新規作成フォームの初期値';
COMMENT ON COLUMN public.mail_boxes.signature IS '旧: 受信箱ごとの署名。migration 105 で署名マスタへ移行済み(未使用)';
CREATE INDEX IF NOT EXISTS idx_mail_boxes_default_signature ON public.mail_boxes(default_signature_id);

-- 3) 既存の署名を署名マスタへ写す(本文が同じものは 1 件。名前は差出人表示名、無ければアドレス)。再実行しても増えない
INSERT INTO public.mail_signatures (name, body)
SELECT
  coalesce(min(nullif(trim(b.display_name), '')), min(b.address)) AS name,
  trim(b.signature) AS body
FROM public.mail_boxes b
WHERE nullif(trim(b.signature), '') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.mail_signatures s WHERE s.body = trim(b.signature))
GROUP BY trim(b.signature);

UPDATE public.mail_boxes b
SET default_signature_id = s.id
FROM public.mail_signatures s
WHERE b.default_signature_id IS NULL
  AND nullif(trim(b.signature), '') IS NOT NULL
  AND s.body = trim(b.signature);
