-- ============================================================================
-- 共通 SQL 関数(ID 採番、ユーザートリガー等)
-- 仕様書 §4.1 §5.3 §7.3 に基づく
-- 配置: supabase/migrations/03_functions.sql
-- ============================================================================

-- ============================================================================
-- TA-XXXXXXX の問合せID採番関数
-- 既存ID は 01_schema.sql で text PK のため、新規採番時に呼び出す。
-- ============================================================================
CREATE OR REPLACE FUNCTION public.gen_ta_id()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  next_num int;
  new_id   text;
BEGIN
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(id FROM 4) AS int)
  ), 0) + 1
  INTO next_num
  FROM public.inquiries
  WHERE id ~ '^TA-[0-9]{7}$';

  new_id := 'TA-' || LPAD(next_num::text, 7, '0');
  RETURN new_id;
END;
$$;

-- ============================================================================
-- K-XXXXXXX の会員ID採番関数
-- ============================================================================
CREATE OR REPLACE FUNCTION public.gen_k_id()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  next_num int;
  new_id   text;
BEGIN
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(id FROM 3) AS int)
  ), 0) + 1
  INTO next_num
  FROM public.members
  WHERE id ~ '^K-[0-9]{7}$';

  new_id := 'K-' || LPAD(next_num::text, 7, '0');
  RETURN new_id;
END;
$$;

-- ============================================================================
-- M-XXXXXXX の申込ID採番関数
-- ============================================================================
CREATE OR REPLACE FUNCTION public.gen_m_id()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  next_num int;
  new_id   text;
BEGIN
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(id FROM 3) AS int)
  ), 0) + 1
  INTO next_num
  FROM public.applications
  WHERE id ~ '^M-[0-9]{7}$';

  new_id := 'M-' || LPAD(next_num::text, 7, '0');
  RETURN new_id;
END;
$$;

-- ============================================================================
-- auth.users → public.users 同期トリガー
-- 仕様書 §7.3: 初回ログイン時に public.users レコードを作成。
-- ※ role の初期値は 'viewer'。admin が後から変更する。
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, role, is_active)
  VALUES (NEW.id, NEW.email, 'viewer', true)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- auth.users に対するトリガーは Supabase のマイグレーションで設定。
-- ローカル開発時のみ以下を有効化する想定。
-- DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-- CREATE TRIGGER on_auth_user_created
--   AFTER INSERT ON auth.users
--   FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
