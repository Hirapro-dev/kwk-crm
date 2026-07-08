-- ============================================================================
-- 出金管理-親/子: 取込対象外の列を削除 (2026-07)
-- CLAUDE.md §5.13 更新に対応
--
-- 背景:
--   取込列を以下に確定(ユーザー指定)したため、migration 63/64 で用意した
--   予備列(出金管理【親/子】ラベル・SF系ID)をテーブルとフィールド管理から削除する。
--     親: 償還-親No / 会員ID / 会員氏名 / 投資案件 / ｷｬﾝﾍﾟｰﾝ名 / 元金 / 利益 / 元利合計
--     子: 償還-子No / 償還-親No / 会員ID / 会員氏名 / 投資案件 / ｷｬﾝﾍﾟｰﾝ名 / 出金日 / 出金額
--
-- 冪等: IF EXISTS / WHERE 条件により、63/64 の適用有無どちらの状態でも安全。
-- ============================================================================

ALTER TABLE public.withdrawal_parents
  DROP COLUMN IF EXISTS management_label,
  DROP COLUMN IF EXISTS member_legacy_sf_id;

ALTER TABLE public.withdrawal_children
  DROP COLUMN IF EXISTS management_label,
  DROP COLUMN IF EXISTS member_legacy_sf_id,
  DROP COLUMN IF EXISTS legacy_parent_sf_id,
  DROP COLUMN IF EXISTS legacy_sf_id;

-- フィールド管理からも削除(詳細画面に空項目が並ばないように)
DELETE FROM public.field_definitions
WHERE object_id = 'withdrawal_parents'
  AND field_name IN ('management_label', 'member_legacy_sf_id');

DELETE FROM public.field_definitions
WHERE object_id = 'withdrawal_children'
  AND field_name IN ('management_label', 'member_legacy_sf_id', 'legacy_parent_sf_id', 'legacy_sf_id');
