-- ============================================================================
-- migration 96: マスター管理(広告マスタ / 顧客情報取得ポイントマスタ) (2026-09-16)
--               CLAUDE.md §5.18 / §5.19 / §8.1
--
-- 目的:
--   設定画面に「マスター管理」のメニューを設け、案件マスタに加えて
--   広告マスタ(Salesforce の広告IDマスタ 4 ファイル、176 件)と
--   顧客情報取得ポイントマスタ(会員の「個人情報取得ポイント」の選択肢、46 件)を置く。
--
-- 方針(案件マスタ projects と同じ):
--   - 物理削除はせず is_active で無効化。created_at/updated_at + set_updated_at トリガー。
--   - RLS: SELECT は全ロール(参照用)、書込は admin のみ。
--   - 初期データはこの migration で投入(ON CONFLICT DO NOTHING。再実行しても重複しない)。
-- ============================================================================

-- 1) 広告マスタ(広告ID は Salesforce の値 N0000003 などを主キーに温存)
CREATE TABLE IF NOT EXISTS public.ad_masters (
  id          text PRIMARY KEY,                 -- 広告ID (N0000003)
  ad_type     text NOT NULL,                    -- 広告種別 (KAWARA版 / カジノIR / 仮想通貨長者 / 紳士協定.com)
  name        text NOT NULL,                    -- 広告媒体名
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ad_masters IS '広告マスタ(広告ID / 広告種別 / 広告媒体名)。CLAUDE.md §5.18';
CREATE INDEX IF NOT EXISTS idx_ad_masters_type ON public.ad_masters(ad_type, id);

DROP TRIGGER IF EXISTS trg_ad_masters_updated_at ON public.ad_masters;
CREATE TRIGGER trg_ad_masters_updated_at
  BEFORE UPDATE ON public.ad_masters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.ad_masters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ad_masters_select ON public.ad_masters;
DROP POLICY IF EXISTS ad_masters_write  ON public.ad_masters;
CREATE POLICY ad_masters_select ON public.ad_masters FOR SELECT USING (true);
CREATE POLICY ad_masters_write  ON public.ad_masters FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 2) 顧客情報取得ポイントマスタ(会員の info_acquired_points の選択肢。名前で一意)
CREATE TABLE IF NOT EXISTS public.acquisition_point_masters (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE,             -- 個人情報取得ポイント名
  sort_order  integer NOT NULL DEFAULT 100,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.acquisition_point_masters IS
  '顧客情報取得ポイントマスタ(会員の「個人情報取得ポイント」の選択肢)。CLAUDE.md §5.19';

DROP TRIGGER IF EXISTS trg_acquisition_point_masters_updated_at ON public.acquisition_point_masters;
CREATE TRIGGER trg_acquisition_point_masters_updated_at
  BEFORE UPDATE ON public.acquisition_point_masters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.acquisition_point_masters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS acquisition_point_masters_select ON public.acquisition_point_masters;
DROP POLICY IF EXISTS acquisition_point_masters_write  ON public.acquisition_point_masters;
CREATE POLICY acquisition_point_masters_select ON public.acquisition_point_masters FOR SELECT USING (true);
CREATE POLICY acquisition_point_masters_write  ON public.acquisition_point_masters FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 3) 初期データ: 広告マスタ(広告IDマスタ CSV 4 ファイル。2026-09-16 書き出し)
INSERT INTO public.ad_masters (id, ad_type, name) VALUES
  ('N0000003', 'KAWARA版', '【KAWARA版広告】原田陽平の公式メールマガジン'),
  ('N0000004', 'KAWARA版', '【KAWARA版広告】アフィリエイターT氏メルマガ'),
  ('N0000005', 'KAWARA版', '【KAWARA版広告】投資副業商材メルマガ'),
  ('N0000006', 'KAWARA版', '【KAWARA版広告】川島和正'),
  ('N0000007', 'KAWARA版', '【KAWARA版広告】インフォカート　購入者通信'),
  ('N0000008', 'KAWARA版', '【KAWARA版広告】インフォカート　購入完了メール'),
  ('N0000009', 'KAWARA版', '【KAWARA版広告】インフォカート　アフィリ通信'),
  ('N0000010', 'KAWARA版', '【タイムライン】KAWARA版一般会員'),
  ('N0000011', 'KAWARA版', '【タイムライン】KAWARA版正会員'),
  ('N0000012', 'KAWARA版', '【KAWARA版】プッシュ通知'),
  ('N0000013', 'KAWARA版', '【KAWARA版広告】倒産経営者が語る'),
  ('N0000014', 'KAWARA版', '【KAWARA版広告】【実録!】ニュースアイ'),
  ('N0000015', 'KAWARA版', '【KAWARA版広告】フォーブランド'),
  ('N0000016', 'KAWARA版', '【KAWARA版広告】渡辺FXスクール'),
  ('N0000017', 'KAWARA版', '【KAWARA版広告】ケンジFX'),
  ('N0000018', 'KAWARA版', '【KAWARA版広告】デイトレーダー剛'),
  ('N0000019', 'KAWARA版', '【KAWARA版広告】よく当たるFX為替レート予想'),
  ('N0000020', 'KAWARA版', '【KAWARA版広告】ゆとりのFXスキャルピング'),
  ('N0000021', 'KAWARA版', '【KAWARA版広告】FXミリオネア'),
  ('N0000022', 'KAWARA版', '【KAWARA版広告】せきねもん'),
  ('N0000023', 'KAWARA版', '【KAWARA版広告】リッチメニュー経由'),
  ('N0000024', 'KAWARA版', '【KAWARA版広告】金持ち父さんの教え'),
  ('N0000025', 'KAWARA版', '【KAWARA版広告】シャーク投資情報'),
  ('N0000026', 'KAWARA版', '【KAWARA版広告】FXで儲ける技術'),
  ('N0000027', 'KAWARA版', '【KAWARA版広告】岡島やえもん'),
  ('N0000028', 'KAWARA版', '【KAWARA版広告】北浜流一郎'),
  ('N0000029', 'KAWARA版', '【KAWARA版広告】投資情報通信'),
  ('N0000030', 'KAWARA版', '【KAWARA版広告】ゼロから始める投資スクール'),
  ('N0000031', 'KAWARA版', '【KAWARA版】フェイスブック投稿'),
  ('N0000032', 'KAWARA版', '【KAWARA版広告】インフォトップPlus'),
  ('N0000033', 'KAWARA版', '【KAWARA版】メルマガフッター'),
  ('N0000034', 'KAWARA版', '【KAWARA版広告】アフィリエイターT氏メルマガ'),
  ('N0000035', 'KAWARA版', '【KAWARA版広告】投資副業商材メルマガ'),
  ('N0000036', 'KAWARA版', '【KAWARA版広告】せきねもん'),
  ('N0000037', 'KAWARA版', '【KAWARA版広告】せきねもん'),
  ('N0000038', 'KAWARA版', '【KAWARA版広告】せきねもん'),
  ('N0000039', 'KAWARA版', '【KAWARA版広告】FXインジケーター'),
  ('N0000040', 'KAWARA版', '【KAWARA版広告】FXインジケーター'),
  ('N0000041', 'KAWARA版', '【KAWARA版広告】DEmail'),
  ('N0000044', 'KAWARA版', '【KAWARA版広告】FX-EA研究所'),
  ('N0000045', 'KAWARA版', '【KAWARA版広告】FX-EA研究所'),
  ('N0000052', 'KAWARA版', '【KAWARA版広告】投資キャンペーンメルマガ'),
  ('N0000053', 'KAWARA版', '【KAWARA版広告】投資キャンペーンメルマガ'),
  ('N0000056', 'KAWARA版', '【KAWARA版広告】暴露板'),
  ('N0000060', 'KAWARA版', '【KAWARA版広告】FTK'),
  ('N0000061', 'KAWARA版', '【KAWARA版広告】なかのしょーた'),
  ('N0000063', 'KAWARA版', '【KAWARA版広告】ダメおやじ'),
  ('N0000064', 'KAWARA版', '【KAWARA版広告】さぼてん'),
  ('N0000070', 'KAWARA版', '【KAWARA版広告】みんかぶ'),
  ('N0000071', 'KAWARA版', '【KAWARA版広告】ZUU online'),
  ('N0000075', 'KAWARA版', '【KAWARA版広告】投資副業商材メルマガ'),
  ('N0000081', 'KAWARA版', '【KAWARA版広告】がんばれ社長'),
  ('N0000156', 'KAWARA版', '【10万人CP2】World Life メールマガジン'),
  ('N0000157', 'KAWARA版', '【10万人CP2】World Life メールマガジン'),
  ('N0000158', 'KAWARA版', '【10万人CP2】World Life メールマガジン'),
  ('N0000159', 'KAWARA版', '【10万人CP2】せきねもん'),
  ('N0000160', 'KAWARA版', '【10万人CP2】サンクスマイル'),
  ('N0000161', 'KAWARA版', '【10万人CP2】投資キャンペーンメルマガ'),
  ('N0000162', 'KAWARA版', '【10万人CP2】投資キャンペーンメルマガ'),
  ('N0000163', 'KAWARA版', '【10万人CP2】投資キャンペーンメルマガ'),
  ('N0000164', 'KAWARA版', '【KAWARA版広告】松本剛徹'),
  ('N0000165', 'KAWARA版', '【10万人CP2】暴露板'),
  ('N0000166', 'KAWARA版', '【KAWARA版広告】World Life メールマガジン'),
  ('N0000167', 'KAWARA版', '【10万人CP2】せきねもん'),
  ('N0000168', 'KAWARA版', '【KAWARA版広告】投資副業商材メルマガ'),
  ('N0000169', 'KAWARA版', '【KAWARA版広告】投資副業商材メルマガ'),
  ('N0000170', 'KAWARA版', '【10万人CP2】投資副業商材メルマガ'),
  ('N0000171', 'KAWARA版', '【10万人CP2】川島和正'),
  ('N0000172', 'KAWARA版', '【10万人CP2】サンクスマイル'),
  ('N0000179', 'KAWARA版', '【10万人CP2】ビズリメイク通信'),
  ('N0000184', 'KAWARA版', '【KAWARA版広告】投資キャンペーンメルマガ'),
  ('N0000185', 'KAWARA版', '【KAWARA版広告】投資キャンペーンメルマガ'),
  ('N0000186', 'KAWARA版', '【10万人CP2】投資キャンペーンメルマガ'),
  ('N0000187', 'KAWARA版', '【KAWARA版広告】投資トレーニング通信'),
  ('N0000188', 'KAWARA版', '【KAWARA版広告】サンクスマイル'),
  ('N0000189', 'KAWARA版', '【KAWARA版広告】せきねもん'),
  ('N0000190', 'KAWARA版', '【KAWARA版広告】せきねもん'),
  ('N0000191', 'KAWARA版', '【KAWARA版広告】投資副業商材メルマガ'),
  ('N0000192', 'KAWARA版', '【KAWARA版広告】投資副業商材メルマガ'),
  ('N0000193', 'KAWARA版', '【KAWARA版広告】投資副業商材メルマガ'),
  ('N0000194', 'KAWARA版', '【KAWARA版広告】アフィリエイターT氏'),
  ('N0000195', 'KAWARA版', '【KAWARA版広告】アフィリエイターT氏'),
  ('N0000196', 'KAWARA版', '【KAWARA版広告】アフィリエイターT氏'),
  ('N0000197', 'KAWARA版', '【KAWARA版広告】長田淳司'),
  ('N0000198', 'KAWARA版', '【KAWARA版広告】長田淳司'),
  ('N0000199', 'KAWARA版', '【KAWARA版広告】投資トレーニング通信'),
  ('N0000200', 'KAWARA版', '【KAWARA版広告】投資副業商材メルマガ'),
  ('N0000201', 'KAWARA版', '【KAWARA版広告】投資キャンペーンメルマガ'),
  ('N0000202', 'KAWARA版', '【KAWARA版広告】投資キャンペーンメルマガ'),
  ('N0000207', 'KAWARA版', '【KAWARA版広告】World Life メールマガジン'),
  ('N0000208', 'KAWARA版', '【KAWARA版広告】World Life メールマガジン'),
  ('N0001110', 'KAWARA版', 'KAWARA版テスト広告'),
  ('N9999900', 'KAWARA版', 'Google広告'),
  ('N9999901', 'KAWARA版', 'Yahoo広告'),
  ('N9999902', 'KAWARA版', 'ネット広告'),
  ('N9999903', 'KAWARA版', 'フェイスブック広告'),
  ('N9999904', 'KAWARA版', 'インスタグラム広告'),
  ('N9999910', 'KAWARA版', 'フェイスブック広告（レスキューサービス）'),
  ('N9999911', 'KAWARA版', '【インフォクロス】KAWARA版1'),
  ('N9999912', 'KAWARA版', '【インフォクロス】KAWARA版2'),
  ('N9999913', 'KAWARA版', '【インフォクロス】KAWARA版3'),
  ('N9999914', 'KAWARA版', '【インフォクロス】KAWARA版4'),
  ('N9999915', 'KAWARA版', '【インフォクロス】KAWARA版5'),
  ('N9999930', 'KAWARA版', 'フェイスブック広告（lp-sim）'),
  ('N9999990', 'KAWARA版', '配信コンテンツ（記事など）'),
  ('N0000000', 'カジノIR', '【カジノIR広告】自社アフィリ'),
  ('N0000001', 'カジノIR', '【カジノIR広告】夢丸インベストメント'),
  ('N0000002', 'カジノIR', '【カジノIR広告】週間大人ののぞき穴'),
  ('N0001589', 'カジノIR', '【カジノIR広告】不明1'),
  ('N0001862', 'カジノIR', '【カジノIR広告】川島和正'),
  ('N0001863', 'カジノIR', '【カジノIR広告】WEBNILE'),
  ('N0001864', 'カジノIR', '【カジノIR広告】RMO-仮想通貨アフィリ'),
  ('N0001865', 'カジノIR', '【カジノIR広告】FXで儲ける技術'),
  ('N0001866', 'カジノIR', '【カジノIR広告】よつばITビジネス通信'),
  ('N0001867', 'カジノIR', '【カジノIR広告】ベジータ'),
  ('N0001868', 'カジノIR', '【カジノIR広告】投資副業メルマガパック'),
  ('N0001869', 'カジノIR', '【カジノIR広告】大森淳弘公式ビジネスメールマガジン'),
  ('N0002080', 'カジノIR', '【カジノIR広告】ロシア政治経済ジャーナル'),
  ('N0002081', 'カジノIR', '【カジノIR広告】坂本よしたか広告（メルマガ）'),
  ('N0002082', 'カジノIR', '【カジノIR広告】坂本よしたか広告（LINE＠）'),
  ('N0002083', 'カジノIR', '【カジノIR広告】原田陽平の公式メールマガジン'),
  ('N0002084', 'カジノIR', '【カジノIR広告】ミツ'),
  ('N0002201', 'カジノIR', '【カジノIR広告】サヤ取り王子'),
  ('N0002202', 'カジノIR', '【カジノIR広告】与沢翼'),
  ('N0002203', 'カジノIR', '【カジノIR広告】せきねもん'),
  ('N0002205', 'カジノIR', '【カジノIR広告】BITTIMES'),
  ('N0002660', 'カジノIR', '【カジノIR広告】S氏の相場観'),
  ('N0003502', 'カジノIR', '【カジノIR広告】仮想通貨パック（メール）'),
  ('N0003503', 'カジノIR', '【カジノIR広告】仮想通貨パック（LINE）'),
  ('N0003510', 'カジノIR', '【カジノIR広告】カブステ'),
  ('N0003594', 'カジノIR', '【カジノIR広告】テスト'),
  ('N0004178', 'カジノIR', '【カジノIR広告】なかのしょーた（LINE）'),
  ('N0004347', 'カジノIR', '【カジノIR広告】インフォカート　購入者通信'),
  ('N0004348', 'カジノIR', '【カジノIR広告】インフォカート　アフィリ通信'),
  ('N0004350', 'カジノIR', '【カジノIR広告】投資属性S'),
  ('N0004375', 'カジノIR', '【カジノIR広告】クロユキ'),
  ('N9999998', 'カジノIR', '【リスティング】カジノIR長者'),
  ('N9999999', 'カジノIR', '【ディスプレイ経由】カジノIR長者'),
  ('N0000042', '仮想通貨長者', '【仮想通貨広告】リッチメニュー経由'),
  ('N0000043', '仮想通貨長者', '【仮想通貨広告】リッチメニュー経由（正会員）'),
  ('N0000047', '仮想通貨長者', '【仮想通貨広告】川島和正'),
  ('N0000048', '仮想通貨長者', '【仮想通貨広告】投資副業商材メルマガ'),
  ('N0000049', '仮想通貨長者', '【仮想通貨広告】せきねもん'),
  ('N0000050', '仮想通貨長者', '【仮想通貨広告】投資副業商材メルマガ'),
  ('N0000051', '仮想通貨長者', '【仮想通貨広告】投資副業商材メルマガ'),
  ('N0000054', '仮想通貨長者', '【仮想通貨広告】投資キャンペーンメルマガ'),
  ('N0000055', '仮想通貨長者', '【仮想通貨広告】ビットコイン予備校'),
  ('N0000057', '仮想通貨長者', '【仮想通貨広告】投資キャンペーンメルマガ'),
  ('N0000058', '仮想通貨長者', '【仮想通貨広告】投資キャンペーンメルマガ'),
  ('N0000059', '仮想通貨長者', '【タイムライン】仮想通貨長者'),
  ('N0000062', '仮想通貨長者', '【仮想通貨広告】BIT TIMES'),
  ('N0000065', '仮想通貨長者', '【仮想通貨広告】アフィリエイターT氏メルマガ'),
  ('N0000072', '仮想通貨長者', '【仮想通貨広告】月刊暗号資産オンライン'),
  ('N0000073', '仮想通貨長者', '【仮想通貨広告】月刊暗号資産オンライン'),
  ('N0000074', '仮想通貨長者', '【仮想通貨広告】月刊暗号資産オンライン'),
  ('N0000076', '仮想通貨長者', '【仮想通貨広告】BIT TIMES'),
  ('N0000077', '仮想通貨長者', '【仮想通貨広告】BIT TIMES'),
  ('N0000078', '仮想通貨長者', '【仮想通貨広告】BIT TIMES'),
  ('N0000079', '仮想通貨長者', '【仮想通貨広告】BIT TIMES'),
  ('N0000080', '仮想通貨長者', '【仮想通貨広告】WBL'),
  ('N0004369', '仮想通貨長者', '【仮想通貨広告】川島和正'),
  ('N0004370', '仮想通貨長者', '【仮想通貨広告】ロシア政治経済ジャーナル'),
  ('N0004371', '仮想通貨長者', '【仮想通貨広告】スマホでラクリッチ'),
  ('N0004372', '仮想通貨長者', '【仮想通貨広告】ほったらかし片手間投資'),
  ('N0004373', '仮想通貨長者', '【仮想通貨広告】仮想通貨フレンズ'),
  ('N0004374', '仮想通貨長者', '【仮想通貨広告】クロユキ'),
  ('N0004380', '仮想通貨長者', '【仮想通貨広告】Bitstock'),
  ('N0004381', '仮想通貨長者', '【仮想通貨広告】コインテレグラフ'),
  ('N0004382', '仮想通貨長者', '【仮想通貨広告】Achievement ASP'),
  ('N9999905', '仮想通貨長者', 'ネット広告'),
  ('N9999921', '仮想通貨長者', '【インフォクロス】仮想通貨レスキュー1'),
  ('N9999922', '仮想通貨長者', '【インフォクロス】仮想通貨レスキュー2'),
  ('N9999923', '仮想通貨長者', '【インフォクロス】仮想通貨レスキュー3'),
  ('N9999924', '仮想通貨長者', '【インフォクロス】仮想通貨レスキュー4'),
  ('N9999925', '仮想通貨長者', '【インフォクロス】仮想通貨レスキュー5'),
  ('N0000300', '紳士協定.com', 'ネット広告（紳士協定.com）')
ON CONFLICT (id) DO NOTHING;

-- 4) 初期データ: 顧客情報取得ポイントマスタ(個人情報取得ポイント集計 CSV の 2 行目。2026-09-16 書き出し)
INSERT INTO public.acquisition_point_masters (name, sort_order) VALUES
  ('ADA詳細希望', 10),
  ('ASECコインプレゼントCP', 20),
  ('GPP SG LIVE配信機密保持契約', 30),
  ('GPPLIVE配信機密保持契約', 40),
  ('GPPイベント初参加者限定 ASECコインプレゼントCP', 50),
  ('GPP公式LINEアンケートキャンペーン', 60),
  ('GPP説明会参加申込', 70),
  ('KAWARA版10万人突破記念キャンペーン', 80),
  ('KAWARA版アンケート', 90),
  ('KAWARA版フリーダイヤル入電', 100),
  ('KAWARA版正会員', 110),
  ('KAWARA版総合問い合わせフォーム', 120),
  ('KAWARA版診断テスト結果', 130),
  ('SCPP LIVE配信機密保持契約', 140),
  ('SCTインサイダークラブ', 150),
  ('XELSプロジェクト勉強会初参加者限定 XELSコインプレゼントCP', 160),
  ('XELS勉強会動画視聴申請', 170),
  ('XELS勉強会参加申込', 180),
  ('“ほったらかし投資”情報配信サービス', 190),
  ('【分析WEBレポート請求】受信データ', 200),
  ('【分析WEBレポート請求】本人確認完了', 210),
  ('【分析WEBレポート（アンケート）】', 220),
  ('【次世代ウェルネス×資産形成】', 230),
  ('【正会員】脱炭素マーケット.com XELS資料請求', 240),
  ('【第二弾】KAWARA版10万人突破記念キャンペーン', 250),
  ('コンテンツ配信アンケートフォーム', 260),
  ('ポートフォリオ診断テストフォーム', 270),
  ('リスト外獲得', 280),
  ('仮想通貨レスキューサービス', 290),
  ('便利屋サービス', 300),
  ('全員当選くじ引き企画', 310),
  ('大島昇氏インタビュー動画', 320),
  ('投資の脱炭素マーケット.com LIVE配信機密保持契約', 330),
  ('投資の脱炭素マーケット.com 審査前LP', 340),
  ('投資の脱炭素マーケット.com 審査前LP【仮想通貨民ホイホイ】', 350),
  ('投資の脱炭素マーケット.com 審査前LP【資産家ホイホイ】', 360),
  ('投資案件調査サービス', 370),
  ('既存顧客からの紹介', 380),
  ('次世代ウェルネス戦略LIVE配信', 390),
  ('特別レポート申込', 400),
  ('脱炭素.com（正会員）', 410),
  ('脱炭素マーケット.com XELS資料請求', 420),
  ('説明会紹介キャンペーン', 430),
  ('資産運用AI分析ツール', 440),
  ('資産運用AI分析ツール（なんとなく投資）', 450),
  ('資産運用AI分析ツール（気になる銘柄のリスク分析）', 460)
ON CONFLICT (name) DO NOTHING;
