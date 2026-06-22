# npm / pnpm 両対応ガイド

このプロジェクトは **npm と pnpm のどちらでも開発可能** です。

## クイックスタート(npm)

```bash
# 1. 依存関係インストール
npm install

# 2. 環境変数を用意(空ファイルでも dev 起動だけは可能)
cp .env.example .env.local
# Supabase URL / Key を埋める

# 3. 開発サーバー起動
npm run dev
# → http://localhost:3000
```

## クイックスタート(pnpm)

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

## 利用可能なスクリプト

`package.json` の `scripts` セクションに定義された全コマンドが、npm / pnpm 両方で動作します。

| コマンド | 内容 |
|---|---|
| `npm run dev` / `pnpm dev` | 開発サーバー(Next.js + Turbopack) |
| `npm run build` / `pnpm build` | 本番ビルド |
| `npm start` / `pnpm start` | 本番起動 |
| `npm run lint` / `pnpm lint` | Biome lint チェック |
| `npm run lint:fix` / `pnpm lint:fix` | Biome 自動修正 |
| `npm run typecheck` / `pnpm typecheck` | TypeScript 型チェック |
| `npm test` / `pnpm test` | Vitest 全テスト実行 |
| `npm run test:e2e` / `pnpm test:e2e` | Playwright E2E |
| `npm run migrate:users` 等 | データ移行スクリプト(Phase 1〜3) |

## ロックファイルの取り扱い

| パッケージマネージャ | ロックファイル | コミットすべきか |
|---|---|---|
| npm | `package-lock.json` | ✅ する |
| pnpm | `pnpm-lock.yaml` | ✅ する |

両方をコミットしても CI 上は問題ないが、**チーム内では1つに統一を推奨**:

- 新規メンバー向けに統一: 例えば npm に統一する場合は `pnpm-lock.yaml` を `.gitignore` に追加
- 移行スクリプトを直接動かすメンバーが多い場合は pnpm が高速

## トラブルシュート

### `npm install` が peer dependency で失敗する

プロジェクト直下の `.npmrc` で `legacy-peer-deps=true` を設定済み。これが効いていない場合は npm のバージョンが古い可能性があるため `npm --version`(10 以上)を確認。

### `nvm` が `globalconfig` 警告を出す

ホームディレクトリの `~/.npmrc` に `globalconfig` / `prefix` が設定されている可能性。プロジェクト直下の `.npmrc` で空文字に上書きしているため、警告は出るが動作には影響なし。気になる場合は以下で消える:

```bash
nvm use --delete-prefix $(node --version) --silent
```

### `npm run dev` で起動するが HTTP 500

`.env.local` の `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` が未設定。Supabase プロジェクトを作成して値を入れること(`docs/DEPLOYMENT.md` 参照)。

### `npm run test` で AppleDouble エラー(`._*` ファイル)

NTFS/exFAT 系のドライブ(macOS で外付け含む)で発生する。`vitest.config.ts` の `exclude` に `**/._*` を追加済みのため通常は出ないが、もし出たら手動削除:

```bash
find . -name "._*" -type f -delete
```

## Vercel デプロイ時の注意

Vercel は `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` を自動検出してパッケージマネージャを選ぶ。

- 1つしかない場合: そのまま使用される
- 複数ある場合: 古いものは無視される可能性があるため、**チーム合意のロックファイルだけをコミット**することを推奨

Settings → Build & Development Settings → Install Command で明示も可能:
- `npm ci` または `pnpm install --frozen-lockfile`

## Phase 0 からの変更点

| 項目 | Phase 0 | 現状(npm 両対応化後) |
|---|---|---|
| `packageManager` フィールド | `pnpm@9.14.2` 強制 | 削除(両方使える) |
| `react` / `react-dom` | RC `19.0.0-rc-66855b96-20241106` | 安定版 `^19.0.0` |
| `@types/react` / `@types/react-dom` | `^18.3.x` | `^19.0.0`(本体と整合) |
| `engines.npm` | 未指定 | `>=10.0.0` |
| `.npmrc` | なし | 追加(legacy-peer-deps 等) |
| `next.config.ts` | `experimental.typedRoutes: true` | コメントアウト(Turbopack 非対応) |
| `vitest.config.ts` | URL ベース alias | 絶対パス alias + `._*` exclude |

## 既知の制約

- **`typedRoutes` を使いたい場合**: `next dev`(`--turbo` を外す)に切り替える、または Turbopack が対応するまで待つ
- **Biome lint の既存警告**: 249 件のスタイル警告は npm 化と無関係。`npm run lint:fix` で自動修正可能なものから順次適用予定
- **Node バージョン**: 20.x で確認済み。22.x でも動くはずだが未検証
