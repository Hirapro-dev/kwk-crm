# 擬似Salesforce (KAWARA版CRM)

KAWARA版/AI極(投資情報サービス)向け、自社最適化CRMシステム。

> **このリポジトリの絶対ルール:** ルートの `CLAUDE.md` (および `claude.md`) が **仕様書本体** です。実装前に必ず参照してください。

---

## 構成

- **フロント**: Next.js 15 (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- **認証 / DB**: Supabase (Auth + Postgres Pro)
- **パッケージ管理**: pnpm
- **Lint / Format**: Biome
- **テスト**: Vitest (unit) + Playwright (E2E)
- **CI**: GitHub Actions

## 開発開始

### 1. 依存関係インストール

```bash
pnpm install
```

### 2. 環境変数設定

```bash
cp .env.example .env.local
```

Supabase プロジェクトを作成し、`.env.local` に以下を設定:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (サーバー専用 / 仕様書 §12.4)

### 3. ローカル DB を立ち上げる(任意)

```bash
pnpm dlx supabase start
pnpm dlx supabase db reset   # マイグレーション適用
pnpm db:types                # TypeScript 型生成
```

### 4. 開発サーバー起動

```bash
pnpm dev
# → http://localhost:3000
```

## ディレクトリ構成(主要)

```
.
├── CLAUDE.md / claude.md         ← 仕様書(必読)
├── app/                          ← Next.js App Router
│   ├── (auth)/login/             ← ログイン画面
│   └── (app)/                    ← 認証後のアプリ画面
├── components/                   ← UIコンポーネント
│   └── layout/                   ← サイドナビ・ヘッダ
├── lib/
│   ├── supabase/                 ← Supabase クライアント
│   ├── reports/                  ← レポート機能(Phase 6)
│   └── utils/                    ← 共通ユーティリティ
├── supabase/
│   ├── config.toml
│   └── migrations/               ← DDL(01〜06)
├── scripts/migrate/              ← CSV移行スクリプト(Phase 1〜3)
├── csv/                          ← 移行元CSV(.gitignore対象)
├── errors/                       ← 移行エラー出力
└── tests/                        ← Vitest / Playwright
```

## 実装フェーズ

仕様書 §10 に従って Phase 0 → 7 で実装する。

| Phase | 内容 | 状態 |
|-------|------|------|
| 0 | 環境構築 | ✓ 完了 |
| 1 | スキーマ + マスタ移行 | 未着手 |
| 2 | コアデータ移行(members/inquiries/applications) | 未着手 |
| 3 | Activity 120万件移行 | 未着手 |
| 4 | 中核UI(会員/活動/ダッシュボード) | 未着手 |
| 5 | 補助UI(問合せ/申込/案件マスタ/ユーザー管理) | 未着手 |
| 6 | レポート機能(Salesforce相当) ★主要 | 未着手 |
| 7 | 仕上げ・本番デプロイ | 未着手 |

## スクリプト

```bash
pnpm dev          # 開発サーバー
pnpm build        # 本番ビルド
pnpm lint         # Biome lint
pnpm lint:fix     # 自動修正
pnpm typecheck    # TypeScript型チェック
pnpm test         # Vitest
pnpm test:e2e     # Playwright
pnpm db:types     # Supabase 型自動生成
```

## 注意事項(仕様書 §12 / §15 抜粋)

- **個人情報・金額情報を扱う**ため、テスト用ダミーデータでも実データ氏名は使わない
- **物理削除禁止**。すべて `deleted_at` で論理削除
- **「商談(Opportunity)」相当のテーブル/概念は作らない**
- 全テーブルに **RLS必須**
- レポートビルダーで動的SQLを組む際は **ホワイトリスト + パラメータ化必須**
- すべてのコミュニケーション・コメント・ドキュメントは **日本語**

詳細は `CLAUDE.md` を参照。
