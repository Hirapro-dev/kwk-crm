-- ============================================================================
-- migration 77: メーラー画面(フォルダ形式)対応 (2026-09)
--
-- 背景:
--   /mail をメールディーラー風の「左: 受信箱フォルダ / 右: メール一覧」構成に変更し、
--   CRM のメニューバーではなく、アプリランチャー(9点アイコン)から
--   「メーラー」として別タブで開く運用にする (仕様書 §5.15 / §8.1)。
--
-- 対応:
--   1. mail_box_counts(): 受信箱ごとの件数 (未対応 / 未読) を1回の呼び出しで返す関数。
--      左のフォルダ一覧にメールディーラーの「新着 N」に相当する件数を出すために使う。
--      - 集計対象は削除されていない「通常」分類のスレッドのみ
--        (メルマガ・迷惑メール等は既定表示に出ないため件数にも含めない)。
--      - SECURITY INVOKER (既定)。呼び出しユーザーの RLS がそのまま効く。
--      - 受信箱が数百件になっても 1 クエリで済むように集計は DB 側で行う。
--   2. nav_items から 'mail' を削除する。メーラーはメニューバーに出さず、
--      アプリランチャーの固定項目 (components/layout/AppLauncherButton.tsx) から開く。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mail_box_counts()
RETURNS TABLE (
  mail_box_id integer,
  pending_count bigint,
  unread_count bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    t.mail_box_id,
    COUNT(*) FILTER (WHERE t.status = '未対応')       AS pending_count,
    COUNT(*) FILTER (WHERE t.is_read = false)         AS unread_count
  FROM public.mail_threads t
  WHERE t.deleted_at IS NULL
    AND t.category = '通常'
  GROUP BY t.mail_box_id;
$$;

COMMENT ON FUNCTION public.mail_box_counts() IS
  'メーラーのフォルダ一覧用: 受信箱ごとの未対応件数・未読件数 (通常分類のみ、RLS 適用)';

GRANT EXECUTE ON FUNCTION public.mail_box_counts() TO authenticated;

-- メーラーはメニューバーに出さない (アプリランチャーから別タブで開く)
DELETE FROM public.nav_items WHERE id = 'mail';
