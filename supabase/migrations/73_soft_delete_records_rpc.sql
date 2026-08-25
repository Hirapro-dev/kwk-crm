-- ============================================================================
-- migration 73: 一覧画面からの論理削除(単体・一括)用 RPC (2026-08)
--
-- 背景:
--   一覧画面の各行に削除ボタンとチェックボックスを追加し、複数選択して
--   まとめて削除できるようにする (仕様書 §8.1)。
--   既存の soft_delete_member(67) / soft_delete_activity(58) は1件ずつのため、
--   N件選択時に N 回のラウンドトリップが発生してしまう。
--
-- 対応:
--   対象オブジェクトとIDの配列を受け取り、1回の呼び出しで論理削除する
--   RPC を1本追加する。
--   - 既存の 58 / 67 と同じ SECURITY DEFINER 方式。
--     (RLS の想定外挙動で deleted_at をセットする UPDATE が拒否されるため、
--      RLS に依存せず関数内で管理者チェックを行う)
--   - p_object はホワイトリストで検証し、CASE で固定 SQL に分岐する。
--     動的SQLの文字列連結は行わない (仕様書 §9.8 の方針に準拠)。
--   - 対象6テーブルはいずれも主キーが text のため、引数は text[] で統一。
--   - AFTER UPDATE の監査トリガー(migration 41)は関数内 UPDATE でも発火し、
--     auth.uid()(=実行した管理者)を actor として記録する。
--     ※ トリガー対象は members / applications / activities / users のみ。
--        本RPCの対象のうち inquiries・出金管理・記事リアクションは
--        監査ログに残らない (migration 41 の対象外)。
--   - 実際に削除できた件数を返す (UI で「N件削除しました」と表示するため)。
--
-- 既存の soft_delete_member / soft_delete_activity は変更しない。
--   (会員詳細・対応歴タイムラインの削除ボタンが現状のまま動き続ける)
-- ============================================================================

-- 一度に削除できる上限。誤操作時の被害を限定するための安全弁。
-- 一覧の「全選択」は画面に読み込み済みの行のみを選ぶ仕様のため、
-- 通常の運用でこの上限に達することはない。
CREATE OR REPLACE FUNCTION public.soft_delete_records(p_object text, p_ids text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_ids constant integer := 500;
  v_count   integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  IF array_length(p_ids, 1) > v_max_ids THEN
    RAISE EXCEPTION 'too many ids: % (max %)', array_length(p_ids, 1), v_max_ids;
  END IF;

  -- p_object はここで許可済みの値のみに分岐する。
  -- テーブル名を文字列連結して EXECUTE することはしない。
  CASE p_object
    WHEN 'members' THEN
      UPDATE public.members
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    WHEN 'inquiries' THEN
      UPDATE public.inquiries
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    WHEN 'applications' THEN
      UPDATE public.applications
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    WHEN 'article_reactions' THEN
      UPDATE public.article_reactions
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    WHEN 'withdrawal_parents' THEN
      UPDATE public.withdrawal_parents
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    WHEN 'withdrawal_children' THEN
      UPDATE public.withdrawal_children
         SET deleted_at = now(), updated_at = now()
       WHERE id = ANY(p_ids) AND deleted_at IS NULL;
    ELSE
      RAISE EXCEPTION 'unknown object: %', p_object;
  END CASE;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.soft_delete_records(text, text[]) TO authenticated;
