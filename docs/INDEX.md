# プロジェクトドキュメント索引

擬似Salesforce(KAWARA版CRM)プロジェクトの全ドキュメント一覧。

## 仕様書本体(必読)

- [`CLAUDE.md` / `claude.md`](../CLAUDE.md) — **プロジェクト唯一の正典**。すべての実装はここに従う。

## Phase 別実装ドキュメント

各 Phase で完成した機能と動作確認手順:

| Phase | ドキュメント | 概要 |
|---|---|---|
| 0 | [`README.md`](../README.md) | 環境構築、スクリプト一覧、注意事項 |
| 1 | [`scripts/migrate/README.md`](../scripts/migrate/README.md) | マスタ移行(users / projects / forms) |
| 2 | [`scripts/migrate/README_PHASE2.md`](../scripts/migrate/README_PHASE2.md) | コアデータ移行(members / inquiries / applications) |
| 3 | [`scripts/migrate/README_PHASE3.md`](../scripts/migrate/README_PHASE3.md) | Activity 120 万件移行 |
| 4 | [`app/README_PHASE4.md`](../app/README_PHASE4.md) | 中核UI(会員 / 活動 / ダッシュボード) |
| 5 | [`app/README_PHASE5.md`](../app/README_PHASE5.md) | 補助UI(問合せ / 申込 / 案件 / ユーザー管理) |
| 6 | [`app/README_PHASE6.md`](../app/README_PHASE6.md) | レポート機能(Salesforce レポート相当) |
| 7 | [`app/README_PHASE7.md`](../app/README_PHASE7.md) | 仕上げ(ダッシュボード・E2E・デプロイ) |

## 運用ドキュメント

- [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) — Supabase + Vercel への本番デプロイ手順、動作確認チェックリスト、トラブルシュート
- [`scripts/migrate/sql/README.md`](../scripts/migrate/sql/README.md) — 活動履歴 120 万件投入時のインデックス DROP/CREATE 手動 SQL

## ディレクトリ構成サマリ

```
crm/
├── CLAUDE.md                       ← 仕様書本体
├── README.md                       ← トップREADME(Phase 0)
├── docs/
│   ├── INDEX.md                    ← このファイル
│   └── DEPLOYMENT.md               ← 本番デプロイ手順
│
├── app/                            ← Next.js 15 App Router
│   ├── README_PHASE4.md            ← 中核UI
│   ├── README_PHASE5.md            ← 補助UI
│   ├── README_PHASE6.md            ← レポート機能
│   ├── README_PHASE7.md            ← 仕上げ
│   ├── layout.tsx
│   ├── error.tsx                   ← グローバルエラー境界(Phase 7)
│   ├── not-found.tsx               ← 404(Phase 7)
│   ├── globals.css
│   ├── (auth)/login/
│   └── (app)/                      ← 認証後アプリ画面
│       ├── layout.tsx
│       ├── loading.tsx             ← Phase 7
│       ├── error.tsx               ← Phase 7
│       ├── page.tsx                ← ダッシュボード(Phase 7 完成版)
│       ├── members/
│       ├── inquiries/
│       ├── applications/
│       ├── activities/
│       ├── projects/
│       ├── reports/                ← Phase 6
│       │   ├── builder/
│       │   ├── new/
│       │   └── [id]/
│       └── admin/users/
│
├── components/
│   ├── ui/                         ← shadcn 相当のプリミティブ
│   ├── layout/                     ← Sidebar / Topbar
│   ├── activities/                 ← ActivityForm / ActivityTimeline
│   └── dashboard/                  ← ReportWidget(Phase 7)
│
├── lib/
│   ├── supabase/                   ← クライアント(client/server/middleware)
│   ├── domain/                     ← ドメインロジック・Server Actions
│   ├── reports/                    ← レポートエンジン(builder_v2 / execute_v2 / export_v2)
│   └── utils/                      ← cn / date 等
│
├── scripts/migrate/                ← Phase 1〜3 移行スクリプト
│   ├── lib/                        ← 共通ユーティリティ
│   ├── sql/                        ← 手動適用 SQL(インデックス DROP/CREATE)
│   └── 01_users.ts 〜 07_activities.ts
│
├── supabase/
│   ├── config.toml
│   └── migrations/                 ← 01〜07 + 02a/05a/06a(本実装版)
│
└── tests/
    ├── unit/                       ← Vitest
    └── e2e/                        ← Playwright(Phase 7)
```

## 主要な設計判断と理由

| 判断 | 理由 | 仕様書 |
|---|---|---|
| 商談オブジェクトを持たない | 活動ログが中核機能、Salesforce のフルセットは不要 | §1.2, §15 |
| 可変項目は JSONB | フォーム/案件ごとに項目が違うが、共通カラムだけスキーマ化 | §4.3 |
| 既存ID(K-/M-/TA-)を text PK | 移行時のトレーサビリティと外部参照を維持 | §3.1, §4.1 |
| 論理削除のみ | 監査要件と誤削除リカバリ | §4.3 |
| 全テーブル RLS | sales が自分担当外を見られない仕組みを DB レベルで保証 | §7.2 |
| レポートはホワイトリスト SQL Builder | 任意 SQL 受付禁止、安全性最優先 | §9.8 |
| service_role はサーバー専用 | クライアント露出禁止 | §12.4 |
| Server Components 優先 | Next.js 15 App Router のベストプラクティス、状態管理が必要なときだけ Client | §12.1 |
| Biome 採用(ESLint/Prettier 代替) | 速度と統一感、設定の簡潔さ | §2.1 |

## 仕様書 §15 Claude Code への指示(再掲・絶対遵守)

1. 新規実装の前に必ず仕様書を読み、対応するセクションを引用してから着手
2. DBスキーマ変更は仕様書 § 5 を先に更新し、ユーザー承認後に migration ファイルを作る
3. 新しいオブジェクト/カラム追加は単独判断禁止
4. エラー時は推測で進めず、ユーザーに報告
5. **「商談(Opportunity)」相当のテーブル/概念は作らない**
6. 個人情報・金額情報を扱うため、テスト用ダミーデータでも実データ氏名は使わない
7. レポートビルダーで動的SQLを組む際は § 9.8 を厳守。**文字列連結禁止、ホワイトリスト+パラメータ化必須**
8. 新しいレポートタイプを追加するときは `lib/reports/schema_all.ts` に定義を追加
9. **すべての応答は日本語**
