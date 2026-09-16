-- ============================================================================
-- migration 98: 顧客情報取得ポイントの改名「未来予測レポート（アンケート）」 (2026-09-16) / CLAUDE.md §5.19
--
-- 内容(ユーザー依頼。2026-09-16 にサービスロールで本番へ適用済み。再実行しても結果は同じ):
--   1. マスタに「未来予測レポート（アンケート）」を追加
--   2. 会員の個人情報取得ポイントが「【分析WEBレポート（アンケート）】」(4 名)のものを
--      「未来予測レポート（アンケート）」に書き換え
--   3. 旧マスタ「【分析WEBレポート（アンケート）】」は無効化(is_active=false。過去の絞り込み用に残す)
--   ※ migration 97(「未来予測レポート」への統合)と同じ方式。書き換え前の会員IDと旧値は作業ログとして保存済み
-- ============================================================================

INSERT INTO public.acquisition_point_masters (name, sort_order)
VALUES ('未来予測レポート（アンケート）', (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM public.acquisition_point_masters))
ON CONFLICT (name) DO NOTHING;

UPDATE public.members
   SET info_acquired_points = '未来予測レポート（アンケート）'
 WHERE info_acquired_points = '【分析WEBレポート（アンケート）】'
   AND deleted_at IS NULL;

UPDATE public.acquisition_point_masters
   SET is_active = false
 WHERE name = '【分析WEBレポート（アンケート）】';
