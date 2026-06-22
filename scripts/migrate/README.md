# 移行スクリプト

仕様書 §6 に従い、Salesforce 由来の CSV を Supabase Postgres に取り込む。

## 前提

1. Supabase プロジェクト作成済み(`.env.local` 設定済み)
2. マイグレーション全件適用済み:
   ```bash
   pnpm dlx supabase db push
   # or ローカル DB の場合:
   pnpm dlx supabase db reset
   ```
3. 移行元 CSV を `./csv/` に配置済み(`.gitignore` 対象)

## Phase 1: マスタ移行

| スクリプト | 入力CSV | 出力テーブル | 件数(目安) |
|---|---|---|---|
| `01_users.ts` | `User2.csv` | `users` | 約102 |
| `02_projects.ts` | `申し込み情報.csv`(抽出) | `projects` | 約44 |
| `03_forms.ts` | `KAWARA版関連.csv` + `機密保持_CP.csv`(抽出) | `forms` | 約20 |

### 実行順序

```bash
# 1. dry-run で検証
pnpm migrate:users -- --dry-run
pnpm migrate:projects -- --dry-run
pnpm migrate:forms -- --dry-run

# 2. 本投入
pnpm migrate:users
pnpm migrate:projects
pnpm migrate:forms

# 3. 検証
pnpm tsx scripts/migrate/verify.ts
```

### 共通オプション

| フラグ | 説明 |
|---|---|
| `--dry-run` | DB 投入をスキップ、件数集計と先頭サンプル表示のみ |
| `--file <path>` | 入力CSVを明示指定(デフォルトは `./csv/<想定名>`) |
| `--limit <N>` | 上位 N 件のみ処理(検証用) |

### エラー出力

各スクリプトはエラーレコードを `./errors/<scriptname>_errors.csv` に書き出す。

- 全列を保持
- 末尾に `_error` 列で原因を記載
- UTF-8 BOM 付き(Excel で開ける)

## Phase 2 以降(未実装)

- `04_members.ts`: 会員 23,580 件 + クレンジング
- `05_inquiries.ts`: 問合せ 8,443 件(2ファイル統合)
- `06_applications.ts`: 申込 4,387 件 + JSONB
- `07_activities.ts`: 活動履歴 1,208,815 件(チャンク投入)

## 重要事項(仕様書 §12 / §15)

- **service_role キー使用**: 移行はRLSバイパスする必要があるため `SUPABASE_SERVICE_ROLE_KEY` を使用
- **個人情報マスキング**: ログには email/phone をマスクして出力(`lib/logger.ts`)
- **冪等性**: `ON CONFLICT (...) DO UPDATE` で多重実行可
- **物理削除禁止**: 全テーブル論理削除(`deleted_at`)
