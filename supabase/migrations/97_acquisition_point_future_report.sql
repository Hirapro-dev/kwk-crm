-- ============================================================================
-- migration 97: 顧客情報取得ポイントの統合「未来予測レポート」 (2026-09-16) / CLAUDE.md §5.19
--
-- 内容(ユーザー依頼。2026-09-16 にサービスロールで本番へ適用済み。再実行しても結果は同じ):
--   1. マスタに「未来予測レポート」を追加
--   2. 会員の個人情報取得ポイントが
--        「【分析WEBレポート請求】本人確認完了」(98 名) / 「【分析WEBレポート請求】受信データ」(63 名)
--      の 161 名を「未来予測レポート」に書き換え
--   3. 旧 2 件のマスタは無効化(is_active=false。過去の絞り込み用に残す)
--   ※ 書き換え前の会員IDと旧値は作業ログとして保存済み(戻す必要があれば個別に復元できる)
-- ============================================================================

INSERT INTO public.acquisition_point_masters (name, sort_order)
VALUES ('未来予測レポート', (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM public.acquisition_point_masters))
ON CONFLICT (name) DO NOTHING;

UPDATE public.members
   SET info_acquired_points = '未来予測レポート'
 WHERE info_acquired_points IN ('【分析WEBレポート請求】本人確認完了', '【分析WEBレポート請求】受信データ')
   AND deleted_at IS NULL;

UPDATE public.acquisition_point_masters
   SET is_active = false
 WHERE name IN ('【分析WEBレポート請求】本人確認完了', '【分析WEBレポート請求】受信データ');
