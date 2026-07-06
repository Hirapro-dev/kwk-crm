# Phase 6: レポート機能(★主要)

仕様書 §9 を全面実装。Salesforce レポート相当のオブジェクト横断抽出・集計機能。

## 実装範囲

| URL | 役割 |
|---|---|
| `/reports` | レポート一覧。標準/カスタム分離、お気に入り絞り込み |
| `/reports/new` | ステップ1: レポートタイプ選択 |
| `/reports/new?type=RT02` | ステップ2: ビルダー(カラム・フィルタ・グルーピング・プレビュー) |
| `/reports/[id]` | 実行・結果表示(テーブル)、CSV/Excel ダウンロードリンク |
| `/reports/[id]/edit` | 編集 |
| `/reports/[id]/export?format=csv\|xlsx` | ダウンロードエンドポイント(Route Handler) |

## レポートタイプ(仕様書 §9.3)

`lib/reports/schema_all.ts` で RT01-RT10 を完全定義:

| ID | 名前 | 主軸 | 用途 |
|---|---|---|---|
| RT01 | 会員一覧 | members | 担当別の会員リスト |
| RT02 | 会員サマリ ★最重要 | members + apps + acts 集計 | 大口会員ランキング等 |
| RT03 | 会員と申込 | applications | 申込ごとに会員・案件結合 |
| RT04 | 会員と活動 | activities | 活動詳細リスト(会員結合) |
| RT05 | 会員と問合せ | inquiries | 問合せのフォーム種別別 |
| RT06 | 申込一覧 | applications | フィルタ多用シナリオ |
| RT07 | 活動一覧 | activities | 活動の純粋抽出 |
| RT08 | 活動マトリクス | activities | 担当×期間×分類クロス |
| RT09 | 問合せ一覧 | inquiries | 未対応・フォーム別件数 |
| RT10 | 案件別実績 | applications | 案件ごとの集計 |

## 安全性(仕様書 §9.8 厳守)

### 1. ホワイトリスト方式
`schema_all.ts` の `REPORT_SCHEMAS[reportType].allowedColumns` に存在するカラムのみ SQL に出る。
ユーザー入力の `source` がこのリストになければ `BuilderError` を投げる。

### 2. パラメータ化クエリ
値は全て `ParamBag` を通して `$1, $2, ...` に置換され、Postgres の `EXECUTE ... USING` で
バインドされる(`07_report_exec_function.sql` の `exec_report_sql`)。
文字列連結は識別子(検証済み)のみ。

### 3. 識別子の正規表現チェック
`isSafeIdentifier()`: `[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$` のみ通す。
セミコロン・スペース・記号類は弾く。

### 4. SQL 文先頭ガード
`exec_report_sql` 関数の中で `^(SET LOCAL ...)?SELECT` 以外を拒否、複文ガードも実装。

### 5. クエリタイムアウト
`statement_timeout = 30s`(関数定義時の `SET` で固定)。30秒で中断されエラーになる。

### 6. 結果行数制限
デフォルト 10,000 行。Excel 出力時は 50,000 行。
`row_limit` が極端でも `MAX_EXCEL_ROW_LIMIT` を超えない。

### 7. RLS による暗黙フィルタ(仕様書 §9.14)
`exec_report_sql` は `SECURITY INVOKER`。呼び出しユーザーの権限で動くため、
`sales` が「全会員サマリ」を実行しても **自動的に自分担当 + Free 担当の会員しか結果に出ない**。

## ビルダー UI(仕様書 §9.10)

`app/(app)/reports/builder/ReportBuilder.tsx`:

- **左ペイン**: 利用可能フィールド一覧。検索可能。クリックで「列に追加」「集計」「条件」「グルーピング」を選択
- **中央**: レポート情報(名前・説明・公開範囲)、選択中の列、フィルタ、グルーピング・ソート
- **右ペイン**: プレビュー(先頭100行、500ms debounce で再実行)。RLS が効いた状態の結果

データ型に応じてフィルタ演算子が自動絞り込み(`FILTER_OPS.supports` で判定)。

## CSV / Excel 出力(仕様書 §9.11)

- **CSV**: `lib/reports/export_v2.ts#toCsv` — UTF-8 BOM 付き、ISO 日時を `YYYY/MM/DD HH:mm` に整形
- **Excel**: `toXlsx` — `xlsx` ライブラリ、ヘッダ太字、日付セルは Date 型として書き出し
- ダウンロードは `app/(app)/reports/[id]/export/route.ts`(Route Handler)、ファイル名は日本語対応(RFC 5987 encoding)

## DB 関数(`07_report_exec_function.sql`)

```sql
exec_report_sql(query_sql text, query_params jsonb) RETURNS jsonb
```

- `query_sql` 先頭が `SELECT`(または `SET LOCAL statement_timeout = X; SELECT`)以外なら拒否
- セミコロン以降の追加文を拒否
- `query_params` を最大8個まで `EXECUTE ... USING` でバインド
- 結果は `jsonb_agg(to_jsonb(t))` で配列として返す → supabase-js から直接 JSON 配列で受け取れる

## 標準レポート 10 件(仕様書 §9.12)

`06a_seed_standard_reports.sql` でシード:

1. 担当者別 今月活動件数
2. 大口会員ランキング(総取引額 TOP100)
3. 案件別 申込件数・金額
4. 未対応問合せリスト
5. 入金予定リスト(今月)
6. 90日以上活動なし会員
7. 担当未割当の大口会員
8. 月次新規問合せ件数(フォーム別)
9. 担当別 活動分類サマリ
10. 申込ステータス分布

最初の admin ユーザーの `id` を `created_by` にセットして `INSERT ... ON CONFLICT DO NOTHING`。
admin がいない環境では `RAISE NOTICE` だけしてスキップ(冪等)。

## マイグレーション適用順

```
01_schema.sql                  ← Phase 0
02_rls_policies.sql            ← Phase 0 雛形
02a_rls_policies.sql           ← Phase 1 本実装
03_functions.sql               ← Phase 0
04_seed_projects.sql           ← Phase 0
05_reports_schema.sql          ← Phase 0
05a_reports_rls.sql            ← Phase 1
06_seed_standard_reports.sql   ← Phase 0 雛形(空)
06a_seed_standard_reports.sql  ← Phase 6 本実装
07_report_exec_function.sql    ← Phase 6 ★必須
```

## テスト

`tests/unit/report_builder.test.ts`:
- 識別子検証(SQL インジェクション拒否)
- 基本 SQL 構築・JOIN 検出
- パラメータ化
- ${current_user} 展開
- LIKE エスケープ
- ホワイトリスト拒否
- row_limit 上限
- ネストフィルタ(AND / OR)
- aggregatable=false の集計拒否

```bash
pnpm test
```

## 動作確認シナリオ

1. `/reports` を開く → 標準レポート 10 件と「+ 新規レポート」が見える
2. 標準レポート「大口会員ランキング」を開く → RLS で自分の閲覧可能範囲だけ表示
3. CSV ダウンロード → Excel で開けることを確認(BOM 付き、日時整形済み)
4. 「+ 新規レポート」→「会員サマリ (RT02)」を選択 → ビルダーで以下を構築
   - 列: 氏名、担当、総取引額、申込件数(count_distinct)、最終活動日(max)
   - フィルタ: 総取引額 ≥ 1,000,000
   - グルーピング: 担当者
   - ソート: 総取引額 降順
5. プレビューがリアルタイム更新されることを確認
6. 保存 → 一覧の「カスタムレポート」セクションに表示
7. ★ をクリックしてお気に入り → `/reports?favorites=1` に表示

## Phase 0 雛形との関係

Phase 0 で作った以下はそれぞれ「**雛形のまま温存**」「**新ファイルで本実装**」の方針:

| Phase 0(編集不可) | Phase 6 本実装 |
|---|---|
| `lib/reports/schema.ts` | `lib/reports/schema_all.ts` |
| `lib/reports/builder.ts` | `lib/reports/builder_v2.ts` |
| `lib/reports/execute.ts` | `lib/reports/execute_v2.ts` |
| `lib/reports/export.ts` | `lib/reports/export_v2.ts` |
| `supabase/migrations/06_seed_standard_reports.sql` | `06a_seed_standard_reports.sql` |
| `app/(app)/reports/page.tsx.phase0.bak` | `app/(app)/reports/page.tsx` |

## 既知の制約・Phase 7 課題

- **グラフ表示**: 結果テーブルのみ。棒/円グラフは Phase 7 で導入検討(`recharts` 等)
- **HAVING 直接編集 UI**: 現状ビルダーから設定不可。標準レポート「90日以上活動なし」も結果から目視
- **マトリクスレポート(列グルーピング)**: schema 上は RT08 で定義済みだが、UI は行グルーピングのみ
- **定期実行**: `report_subscriptions` テーブルはあるが UI 未実装(Phase 2 機能扱い)
- **大規模レポート(>1万行)バックグラウンド実行**: Phase 7 で `report_runs.result_cache` を使う案
- **マテリアライズドビュー活用**: `mv_monthly_activities` は migration 49 で pg_cron による
  日次自動リフレッシュ(日本時間 03:00)を設定済み。ただし RT08 やダッシュボードから
  直接参照する最適化(画面側の切替)は、集計粒度(暦月×担当×大/小分類)が固定のため
  運用要件が固まってから対応する(Phase 7 以降)。
