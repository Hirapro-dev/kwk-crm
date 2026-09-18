-- ============================================================================
-- migration 104: 会員の更新を viewer 以外の全ロールに開放 (2026-09-18) / CLAUDE.md §7.2 / §8.1
--
-- 背景: 会員詳細の編集ダイアログを admin 限定から viewer 以外に開放するにあたり、
--   members の UPDATE ポリシー(migration 33)が「admin か、自分が永久担当(owner_id = auth.uid())の会員」に
--   限られていた。永久担当は約 95% が未設定のため、admin 以外はほとんどの会員を更新できない。
-- 変更: admin / manager / sales / support(can_write)は全会員を更新できる(INSERT と同じ範囲)。
--   削除(deleted_at)は引き続き admin のみ(soft_delete_member / soft_delete_records は SECURITY DEFINER で admin 判定)。
--   プロテクト者・プロテクト日程は Server Action(updateMember)側で admin のみに制限している。
-- ============================================================================
DROP POLICY IF EXISTS members_update ON public.members;
CREATE POLICY members_update ON public.members
  FOR UPDATE
  USING (deleted_at IS NULL AND (SELECT public.can_write()))
  WITH CHECK ((SELECT public.can_write()));
