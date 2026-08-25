-- ============================================================================
-- migration 75: 都道府県をオブジェクト管理の対象項目にする (2026-08)
--
-- 背景:
--   migration 74 で members.prefecture (生成カラム) を追加したが、用途をレポートに
--   限定し field_definitions には登録していなかったため、管理者が
--   /settings/objects から会員一覧・会員詳細への表示を切り替えられなかった。
--
-- 対応:
--   field_definitions に登録し、オブジェクト管理画面から
--   「一覧に表示」「詳細に表示」を切り替えられるようにする (CLAUDE.md §5.4 / §5.9)。
--
--   - 初期値は一覧・詳細とも非表示。既存の画面の見た目は変わらず、
--     管理者が /settings/objects で任意にONにする。
--   - is_in_db = true: members の実カラム (extra jsonb のキーではない)。
--   - is_system = true: 生成カラムのため項目自体の削除は許可しない
--     (object_metadata_actions.ts は is_system=true の削除を拒否する)。
--   - sort_order は「住所」の直後に来る値にする。
--     seed (migration 10) 以降に管理者が画面で並び順を調整しているため、
--     現行値 (住所: 一覧110 / 詳細130) を確認したうえで 一覧115 / 詳細135 とした。
--
-- 補足 (アプリ側の対応):
--   - 一覧のソート許可リスト (lib/domain/members.ts の MEMBER_SORTABLE) に
--     prefecture を追加済み。一覧に表示した際に列ヘッダーから並び替えできる。
--   - 生成カラムは UPDATE できない (DBが拒否する) ため、会員編集ダイアログの
--     SPECIAL_OR_READONLY_FIELDS に追加し、入力欄を出さない。
--     住所を編集すれば都道府県は自動で追従する。
-- ============================================================================

INSERT INTO public.field_definitions
  (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system,
   sort_order_list, sort_order_detail, is_in_db, description)
VALUES
  ('members', 'prefecture', '都道府県', 'text', false, false, true, 115, 135, true,
   '住所から自動導出される生成カラム (migration 74)。編集不可。海外住所は空。')
-- ※ 再適用時に表示ON/OFF・並び順を上書きしないよう、DO UPDATE の対象から
--    is_visible_list / is_visible_detail / sort_order_* を意図的に外している
--    (管理者が画面で切り替えた設定を migration の再実行で戻さないため)。
ON CONFLICT (object_id, field_name) DO UPDATE
  SET label       = EXCLUDED.label,
      data_type   = EXCLUDED.data_type,
      is_in_db    = EXCLUDED.is_in_db,
      is_system   = EXCLUDED.is_system,
      description = EXCLUDED.description,
      updated_at  = now();
