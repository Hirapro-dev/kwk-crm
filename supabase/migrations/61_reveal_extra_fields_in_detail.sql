-- ============================================================================
-- 取込で自動登録された extra 項目を「詳細ページに表示」へ一括切替 (2026-07)
-- CLAUDE.md §5.9 field_definitions / §5.10
--
-- 背景:
--   会員/問合せ/申込のCSVに増えた列は取込時に extra(JSONB) へ格納され、
--   field_definitions に自動登録される(field_registry.ts)。ただし従来は
--   一覧・詳細とも「非表示」で登録されたため、CSVに項目を足しても画面に出ず
--   「更新できていない」ように見えていた。
--
-- 変更:
--   field_registry.ts の既定を「詳細=表示」に変更したのに合わせ、
--   既に非表示で登録済みの extra 項目(is_in_db=false)も詳細表示に切り替える。
--   - 対象は members / inquiries / applications の3オブジェクト
--   - extra 由来のみ(is_in_db=false)。実DBカラム(is_system 等)の設定は変更しない
--   - 空セルのプレースホルダ(is_placeholder=true)は対象外
--   - 一覧(is_visible_list)は変更しない。会員は170列超のため一覧が崩れるのを避ける
--
-- 冪等: 既に is_visible_detail=true の行は WHERE 条件で対象外。
-- ============================================================================

UPDATE public.field_definitions
SET is_visible_detail = true,
    updated_at = now()
WHERE object_id IN ('members', 'inquiries', 'applications')
  AND is_in_db = false          -- extra(JSONB) 由来のみ
  AND is_placeholder = false     -- 空セルのプレースホルダは除外
  AND is_visible_detail = false;
