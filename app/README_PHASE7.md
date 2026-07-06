# Phase 7: 仕上げ

仕様書 §10 Phase 7 に対応。Phase 0〜6 で実装した機能の完成度を高め、本番運用に乗せる準備をする。

## 実装範囲

### 1. ダッシュボード最終形(仕様書 §9.15)

`app/(app)/page.tsx`(Phase 7 で再構築):

- 今日・今月の統計カード(4枚)
- **お気に入りレポート最大3個のウィジェット**(Phase 6 連携、新規)
- 最新活動 10件タイムライン
- ヘッダーに「+ 活動を記録」のショートカット(仕様書 §8.2 3クリック以内)

新規ファイル:
- `lib/domain/dashboard_widgets.ts` — `getFavoriteReportWidgets()`(各レポートを行数制限付きで実行)
- `components/dashboard/ReportWidget.tsx` — 表形式の小型サマリ

### 2. エラー境界・ローディング状態

Next.js App Router 標準機構を活用:

| ファイル | 役割 |
|---|---|
| `app/error.tsx` | グローバルエラー境界(プロダクションでは digest のみ表示) |
| `app/not-found.tsx` | 404 ページ |
| `app/(app)/error.tsx` | アプリ画面用の詳細エラー UI |
| `app/(app)/loading.tsx` | アプリ画面用のスケルトン |

仕様書 §12.4「個人情報をログに出さない」に従い、`error.message` は本番では表示せず `digest` のみ。

### 3. E2E テスト最低限(仕様書 §10 Phase 7)

`tests/e2e/` 配下:

| ファイル | 内容 | 認証 |
|---|---|---|
| `auth_redirect.spec.ts` | 未ログインリダイレクト、フォームバリデーション、誤ログイン拒否 | 不要 |
| `navigation.spec.ts` | ログイン後の主要画面遷移、活動入力フォーム常設確認、ログアウト | `E2E_EMAIL` / `E2E_PASSWORD` 環境変数 |

```bash
# 認証不要分のみ実行
pnpm test:e2e tests/e2e/auth_redirect.spec.ts

# 全 E2E(要環境変数)
E2E_EMAIL=admin@example.com E2E_PASSWORD=xxxx pnpm test:e2e
```

### 4. 本番デプロイ手順書

`docs/DEPLOYMENT.md` を新設。以下を網羅:

- Supabase Pro プロジェクト作成
- Vercel プロジェクト作成と環境変数設定
- マイグレーション適用順
- データ移行手順(Phase 1〜3 の流れ)
- 初期 admin の作成・標準レポートシード
- デプロイ後の動作確認チェックリスト
- ロール別検証
- バックアップ・ロールバック・監視・トラブルシュート

## Phase 0 / Phase 4 プレースホルダの整理

Phase 7 でダッシュボードを再実装したため、Phase 4 版は `.phase4.bak` に退避:

```
app/(app)/page.tsx.phase4.bak  ← Phase 4 のダッシュボード(統計のみ)
app/(app)/page.tsx             ← Phase 7 のダッシュボード(ウィジェット込み)
```

Phase 0 由来の `.phase0.bak` ファイルは全 Phase で退避済み(削除可)。

## 動作確認シナリオ(統合)

`docs/DEPLOYMENT.md` の「デプロイ後の動作確認」と「ロール別動作確認」を参照。

## 仕様書との対応マトリクス

| 仕様書 § | 内容 | Phase | 実装ファイル |
|---|---|---|---|
| §2 | 技術スタック | 0 | `package.json` |
| §4-5 | データモデル | 0-1 | `supabase/migrations/01_schema.sql` 他 |
| §6 | データ移行 | 1-3 | `scripts/migrate/` |
| §7 | 認証・権限 / RLS | 1 | `02a_rls_policies.sql` / `05a_reports_rls.sql` |
| §8.1 | 画面一覧 | 4-5 | `app/(app)/**` |
| §8.2 | 活動入力フォーム(主役) | 4 | `components/activities/ActivityForm.tsx` |
| §8.3 | 活動分類 | 4 | `lib/domain/activities.ts#getDBunruiList` |
| §9.1-9.7 | レポート定義・データ構造 | 6 | `lib/reports/types.ts` / `schema_all.ts` |
| §9.8 | 安全な SQL Builder | 6 | `lib/reports/builder_v2.ts` |
| §9.9-9.10 | レポート画面・ビルダー UI | 6 | `app/(app)/reports/**` |
| §9.11 | CSV/Excel 出力 | 6 | `lib/reports/export_v2.ts` |
| §9.12 | 標準レポート 10 件 | 6 | `06a_seed_standard_reports.sql` |
| §9.13 | パフォーマンス対策 | 3,6 | `mv_monthly_activities`(migration 49 で pg_cron 日次更新設定) / インデックス |
| §9.14 | レポートと RLS | 6 | `exec_report_sql` SECURITY INVOKER |
| §9.15 | ダッシュボード | 7 | `app/(app)/page.tsx` + `dashboard_widgets.ts` |
| §10 | 実装フェーズ | 0-7 | 各 Phase README |
| §12 | 開発規約 | 全 | `biome.json` / `tsconfig.json` |
| §13 | 環境変数 | 0 | `.env.example` / `docs/DEPLOYMENT.md` |
| §15 | Claude Code 指示 | 全 | 全 Phase で遵守 |

## 残課題(将来 Phase / 仕様書 §14)

スコープ外として明示されているもの:

- BioVault 会員・SCPP 法人提携(`business_unit` タグで区別)
- メール配信履歴(`emails` テーブル)
- コイン残高履歴(`coin_balances` テーブル)
- 案件別利用額の縦持ち化(`transactions` テーブル)
- 全文検索(pg_trgm or Meilisearch)
- LINE 公式アカウント連携
- Stripe 等の決済連携
- モバイルアプリ
