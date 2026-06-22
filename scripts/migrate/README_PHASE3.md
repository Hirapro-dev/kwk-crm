# Phase 3: 活動履歴(Activity)移行 120万件

仕様書 §6.1 Phase 3 / §10 Phase 3 に対応。Phase 1・2 完了後に実行。

## 概要

| 項目 | 値 |
|---|---|
| 入力CSV | `extract.csv` |
| 出力テーブル | `public.activities` |
| 件数(想定) | **1,208,815** |
| 想定所要時間 | 1〜3時間(回線・Supabaseインスタンス性能依存) |
| 実装スクリプト | `scripts/migrate/07_activities.ts` |

## 通常実行手順

```bash
# 1. dry-run(parse のみ、DB 投入なし。サンプル確認用)
pnpm migrate:activities -- --dry-run --limit 5000

# 2. 部分投入で動作確認(5万件)
pnpm migrate:activities -- --limit 50000

# 3. インデックスを一時 DROP(任意・高速化)
#    Supabase Studio SQL Editor で:
#    scripts/migrate/sql/activities_drop_indexes.sql を実行

# 4. 本投入
pnpm migrate:activities

# 5. インデックス再作成
#    Supabase Studio SQL Editor で:
#    scripts/migrate/sql/activities_recreate_indexes.sql を実行

# 6. 検証
pnpm tsx scripts/migrate/verify.ts
```

## 性能設計上の選択

### ストリーミング読込

通常の `readCsv()` は全行を一度オンメモリに展開する。120万件 × 1KB ≒ 1.2GB は
Node.js プロセスを不安定にするため、Phase 3 では `lib/csv_stream.ts` を導入:

- `createReadStream` + `readline` で1行ずつ取得
- CSV内改行(クォート未閉鎖)はバッファで結合
- BOM 除去・"" エスケープ対応
- 1行処理ごとにコールバック → メモリ常駐は1バッチ(5,000件)分のみ

### バッチサイズ 5,000

仕様書 §6.1 では「5万件ずつ COPY」だが、Supabase の PostgREST 経由 UPSERT は
ペイロード数百MBになるとタイムアウトしやすい。経験的に 5,000 が安定する上限。
リトライ済み数だけで進捗を判定するため、件数は冪等で再開可能。

### インデックス DROP オプション

`activities` には WHERE 部分インデックス4本+通常インデックス2本がある。
120万件に対する CREATE INDEX は十数分で完了するが、投入中の **INSERT は毎行
インデックス更新を伴う**ため、DROP → 投入 → 再作成のほうが合計で速い:

| 戦略 | INSERT速度 | 索引作成 | 合計目安 |
|---|---|---|---|
| 索引維持 | 遅い(各INSERTで6本更新) | - | 約2-3時間 |
| 索引DROP + 再作成 | 速い | 5-15分 | 約1-1.5時間 |

ただし冪等性確保のため `legacy_sf_id` UNIQUE 制約は維持する。

### 進捗・ハートビート

- 10,000件ごとに parsed/inserted/failed と速度(rows/sec)をログ
- 50,000件ごとに DB 件数を実数で取得(リトライで取りこぼしがないか確認)

## エラー対応

`errors/07_activities_errors.csv` に出力される主な原因:

| 原因 | 対処 |
|---|---|
| `legacy_sf_id missing` | 元CSVに ID 列がない行 → スキップ済み、内容確認 |
| `duplicate key value violates unique constraint "activities_legacy_sf_id_key"` | 通常は UPSERT で吸収。出ているなら同一CSV内の重複ID |
| FK 違反 (owner_id) | users 移行漏れ。owner_id は NULL 許容のため通常は出ない |
| FK 違反 (member_id) | members 未投入 / member_id 形式不正 |
| タイムアウト | 一旦止めて再実行(冪等)。バッチサイズを下げる選択肢も |

## 性能検証(仕様書 §10 Phase 3)

「会員別タイムライン1秒以内」を確認:

```sql
EXPLAIN ANALYZE
SELECT *
FROM public.activities
WHERE member_id = 'K-0000001'
  AND deleted_at IS NULL
ORDER BY registered_datetime DESC
LIMIT 50;
```

期待:
- `Index Scan using idx_act_member_date` を使用
- 実行時間 < 10ms(Pro プランの標準ハードウェアで)

`ANALYZE public.activities;` を再作成スクリプトで実施しているため、
クエリプランナは新統計に基づく計画を立てる。

## オプション一覧

| フラグ | デフォルト | 説明 |
|---|---|---|
| `--dry-run` | false | DB 投入をスキップ、parse のみ |
| `--file <path>` | `./csv/extract.csv` | 入力CSVを指定 |
| `--limit <N>` | 無制限 | 上位 N 件のみ処理(検証用) |

## トラブルシュート

### 「ネットワークが遅すぎる」
→ ローカルから直接 Supabase に投入すると遅い。可能なら Supabase 同リージョン
のVM(GCP / AWS)から流すか、`pg_dump`/`COPY` での移行を検討。

### 「メモリが足りない」
→ `lib/csv_stream.ts` を使っているため、活動データ自体は1バッチ分(5,000件)
しか常駐しない。ただし users と OwnerResolver はメモリ展開しているため、
ユーザー数が極端に多くなければ問題ない(102件想定なら無視可能)。

### 「途中で止まった」
→ 冪等のため、もう一度 `pnpm migrate:activities` を実行すれば、
UPSERT で既存行が更新され、未投入行が挿入される。
