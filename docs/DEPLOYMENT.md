# 本番デプロイ手順書

仕様書 §10 Phase 7 / §11 / §13 に対応。

## 構成

| レイヤ | 採用技術 |
|---|---|
| フロント | Vercel(Next.js 15 App Router) |
| バックエンド | Supabase Pro(Postgres 8GB〜 + Auth + Storage) |
| パッケージ管理 | pnpm |
| CI | GitHub Actions(lint + typecheck + build + test) |

## 事前準備

### 1. Supabase プロジェクト作成

1. <https://supabase.com> で新規プロジェクト作成(**Pro 以上必須**: 仕様書 §2)
2. Region: 東京推奨(ap-northeast-1)
3. データベースパスワードを安全な場所に保存
4. プロジェクト URL と API キー(`anon` / `service_role`)を取得

### 2. Vercel プロジェクト作成

1. <https://vercel.com> で本リポジトリを Import
2. Framework: Next.js を自動検出
3. Build Command: `pnpm build`(自動)
4. Install Command: `pnpm install --frozen-lockfile`
5. Node.js Version: 20.x

### 3. 環境変数設定(Vercel)

仕様書 §13 の `.env.example` 全項目を Vercel の Settings → Environment Variables に設定:

| キー | スコープ | 値の取得元 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production / Preview / Development | Supabase Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 同上 | Supabase Project Settings → API → `anon public` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Production / Preview のみ** | Supabase Project Settings → API → `service_role secret` |

⚠️ `SUPABASE_SERVICE_ROLE_KEY` は絶対にクライアントから参照しない(仕様書 §12.4)。Vercel 上では機密扱い。

### 4. Supabase Auth 設定

1. Supabase Dashboard → Authentication → Providers
2. **Email** を有効化(パスワード認証)
3. **Sign-up** は **無効化**(招待制 / 仕様書 §7.3 / `supabase/config.toml` で `enable_signup = false`)
4. Authentication → URL Configuration:
   - Site URL: `https://crm.your-domain.com`(本番ドメイン)
   - Redirect URLs: `https://crm.your-domain.com/**`(プレビューも追加可)

## マイグレーション適用

Supabase CLI 経由でリポジトリ内 SQL を本番に流す。

### 1. Supabase CLI セットアップ

```bash
pnpm dlx supabase login
pnpm dlx supabase link --project-ref <project-ref>
```

`<project-ref>` は Supabase Dashboard の URL に含まれる文字列。

### 2. マイグレーション一括適用

```bash
pnpm dlx supabase db push
```

適用順(`supabase/migrations/` 配下、ファイル名順):

```
01_schema.sql                  ← Phase 0
02_rls_policies.sql            ← Phase 0(雛形:RLS有効化のみ)
02a_rls_policies.sql           ← Phase 1(本実装)
03_functions.sql               ← Phase 0(ID 採番関数)
04_seed_projects.sql           ← Phase 0(サンプル案件 6 件)
05_reports_schema.sql          ← Phase 0(レポートテーブル)
05a_reports_rls.sql            ← Phase 1(レポート用 RLS)
06_seed_standard_reports.sql   ← Phase 0(雛形:空)
06a_seed_standard_reports.sql  ← Phase 6(標準レポート 10 件、admin 不在ならスキップ)
07_report_exec_function.sql    ← Phase 6(SQL 実行 RPC)
```

### 3. データ移行(初回のみ)

仕様書 §6 / `scripts/migrate/`:

```bash
# 1. CSV を ./csv/ に配置(.gitignore対象)
cp /path/to/exports/*.csv ./csv/

# 2. 環境変数を .env.local に設定
cp .env.example .env.local
# NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY を埋める

# 3. dry-run で確認
pnpm migrate:users -- --dry-run
pnpm migrate:projects -- --dry-run
pnpm migrate:forms -- --dry-run

# 4. マスタ投入(Phase 1)
pnpm migrate:users
pnpm migrate:projects
pnpm migrate:forms

# 5. コア投入(Phase 2)
pnpm migrate:members
pnpm migrate:inquiries
pnpm migrate:applications

# 6. 活動履歴(Phase 3)
# 必要に応じてインデックスDROP
# Supabase Studio で scripts/migrate/sql/activities_drop_indexes.sql を実行
pnpm migrate:activities
# インデックス再作成
# Supabase Studio で scripts/migrate/sql/activities_recreate_indexes.sql を実行

# 7. 検証
pnpm tsx scripts/migrate/verify.ts
```

### 4. 初期 admin の作成

仕様書 §7.3 招待制のため、Supabase Dashboard で手動招待する:

1. Authentication → Users → "Invite user" でメールアドレス入力
2. 招待メールから初回ログイン → パスワード設定
3. SQL Editor で対象ユーザーを admin に昇格:

```sql
UPDATE public.users
SET role = 'admin'
WHERE email = 'admin@your-domain.com';
```

4. ログインし直すと `/admin/users` から他ユーザー管理が可能

### 5. 標準レポートシード再実行(任意)

admin 作成後に標準レポート 10 件を投入:

```sql
-- Supabase Studio SQL Editor で
\i path/to/06a_seed_standard_reports.sql
-- または migration を流し直す
```

## 初回デプロイ

```bash
# CI が緑であることを確認
gh pr checks  # (任意)

# main にマージすると Vercel が自動デプロイ
git push origin main
```

## デプロイ後の動作確認

1. <https://crm.your-domain.com/login> を開いてログイン画面が出る
2. 招待された admin でログイン
3. **検証チェックリスト**:
   - [ ] ダッシュボードに統計が表示される
   - [ ] 会員一覧で検索・ページネーションが動く
   - [ ] 会員詳細でタイムラインが表示され、活動を1件記録できる
   - [ ] 活動履歴の上部入力フォームから直接活動を1件記録できる(§8.2)
   - [ ] 問合せ詳細で「会員化」が動く(未対応問合せがある場合)
   - [ ] 申込詳細でステータス更新が動く
   - [ ] 案件マスタを admin が編集できる
   - [ ] `/admin/users` でロール変更が動く
   - [ ] レポートで標準レポートが10件表示
   - [ ] 「大口会員ランキング」を開き CSV ダウンロードできる(BOM 付きで Excel が文字化けしない)
   - [ ] 「+ 新規レポート」→ RT02 ビルダーで列を追加するとプレビューが更新される
   - [ ] レポート★を押すとダッシュボードにウィジェットが追加される

## ロール別動作確認

仕様書 §7.2 RLS:

| ロール | 確認項目 |
|---|---|
| admin | 全テーブル全件操作可能、ユーザー管理可能、案件マスタ編集可能 |
| manager | 全件閲覧可能、活動編集可能、ユーザー管理不可 |
| sales | 自分担当 + Free担当の会員のみ閲覧、自分作成の活動のみ更新可能、ユーザー管理不可 |
| viewer | 全件閲覧のみ、書き込み拒否 |

## バックアップ

- Supabase Pro は **Point-in-Time Recovery(PITR)** が利用可能(直近7日)
- 月1回、Supabase Dashboard → Database → Backups から手動 dump を取得しオフサイト保管推奨
- `extract.csv` 由来の活動履歴は120万件あるため、初回移行後の dump は必ず保存

## ロールバック

不具合発生時:

1. **Vercel**: Deployments タブから「Promote to Production」で前バージョンに戻す
2. **DB スキーマ変更が含まれる場合**: Supabase の PITR 復元、または事前に取得した dump からリストア

## 監視

- Vercel Analytics(Web Vitals)を有効化
- Supabase Dashboard → Reports でクエリパフォーマンス確認
- 仕様書 §9.13:「会員別タイムライン1秒以内」を `EXPLAIN ANALYZE` で定期確認

```sql
EXPLAIN ANALYZE
SELECT * FROM public.activities
WHERE member_id = 'K-0000001' AND deleted_at IS NULL
ORDER BY registered_datetime DESC LIMIT 50;
```

## トラブルシュート

### ログイン後 500 エラー

→ `public.users` にレコードがない可能性。Supabase Dashboard で対象 auth.users のIDを確認し、`public.users` にINSERTする(`03_functions.sql` のトリガーが有効ならログイン時に自動作成される)。

### レポート実行が「permission denied」

→ `exec_report_sql` 関数の `GRANT EXECUTE` が抜けている。`07_report_exec_function.sql` を再適用。

### 活動履歴の会員別タイムラインが遅い

→ 索引が再作成されていない。`activities_recreate_indexes.sql` を実行し、`ANALYZE public.activities;` を流す。

### 標準レポート 10 件が空

→ admin ユーザーがいない状態で `06a_seed_standard_reports.sql` が実行された。admin 作成後にもう一度実行する(冪等)。

### CSV ダウンロードで日本語が文字化け

→ Excel で開くなら UTF-8 BOM 必須。`lib/reports/export_v2.ts#toCsv` で BOM 付与済み。それでも化ける場合はクライアント側の Excel バージョンを確認。
