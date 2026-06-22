# Phase 5: 補助UI(問合せ / 申込 / 案件マスタ / ユーザー管理)

仕様書 §8.1 / §10 Phase 5 に対応。Phase 4 で動く中核 UI を補助する周辺機能を実装。

## 実装範囲

| URL | 役割 | 主な機能 |
|---|---|---|
| `/inquiries` | 問合せ一覧 | フォーム種別フィルタ、未対応(会員化前)絞り込み |
| `/inquiries/[id]` | 問合せ詳細 | フォーム固有項目表示(JSONB)、**会員化アクション** |
| `/applications` | 申込一覧 | 案件・ステータスでフィルタ |
| `/applications/[id]` | 申込詳細 | 全項目表示、ステータス・入出金区分の更新 |
| `/projects` | 案件マスタ | admin はインライン編集、他ロールは閲覧 |
| `/admin/users` | ユーザー管理 | admin 限定、ロール・有効状態の変更 |

## ドメイン層追加(`lib/domain/`)

| ファイル | 内容 |
|---|---|
| `inquiries.ts` | `listInquiries` / `getInquiry` / `listForms` |
| `inquiry_actions.ts` | `convertInquiryToMember` Server Action |
| `applications.ts` | `listApplications` / `getApplication` + 定数 `APP_STATUSES` / `FLOW_TYPES` |
| `application_actions.ts` | `updateApplicationStatus` Server Action |
| `projects.ts` | `listProjects` / `getProject` + `PROJECT_CATEGORIES` |
| `project_actions.ts` | `upsertProject` Server Action(admin 限定) |
| `users_admin.ts` | `listAllUsers` |
| `user_actions.ts` | `updateUserRole` Server Action(admin 限定 / 自分降格防止) |

## 重要フロー

### 問合せ → 会員化(仕様書 §8.1)

`/inquiries/[id]` の `ConvertButton` から:
1. **既存会員に紐づける** — `K-XXXXXXX` を入力して既存 members レコードと結合
2. **新規会員として作成** — 問合せの email / phone / address / ad_id を転記して新規会員作成
   - 新規 ID は `members` の最大値 +1 を 7 桁ゼロ埋め(`generateMemberId()` で採番)
   - ID 衝突時は1回 retry
3. 成否いずれの場合も `inquiries.member_id` を更新

### 申込ステータス遷移

`/applications/[id]` の `StatusEditor`:
- 仕様書 §3 のフロー: `対応中 → 未購入/完了 → 出金/資金移動`
- 厳密な遷移ルールは Phase 7 で確定予定(現在はどの遷移も許可)

### ロール管理(仕様書 §7.1)

`/admin/users` の `UserRoleEditor`:
- `admin / manager / sales / viewer` の4ロール変更
- **自分自身を非 admin に降格できない**(`user_actions.ts` で防御)
- 招待は Supabase Studio から行う前提(初回ログイン時に viewer として `public.users` に自動追加)

## Phase 0 プレースホルダの扱い

以下4ファイルを `.phase0.bak` 退避(Phase 4 と同じ方法):

```
app/(app)/inquiries/page.tsx.phase0.bak
app/(app)/applications/page.tsx.phase0.bak
app/(app)/projects/page.tsx.phase0.bak
app/(app)/admin/users/page.tsx.phase0.bak
```

## RLS との整合(仕様書 §7.2)

| テーブル | sales | admin/manager | viewer |
|---|---|---|---|
| inquiries | SELECT: 全件 / UPDATE: 自分担当の会員に紐付くもの | 全件編集 | SELECT のみ |
| applications | SELECT/UPDATE: 自分担当会員のもの | 全件編集 | SELECT のみ |
| projects | SELECT のみ | admin: 編集可 / manager: SELECT のみ | SELECT のみ |
| users | SELECT: 自分 + 全件閲覧 / UPDATE: 自分のプロフィール | admin: 編集可 | SELECT のみ |

Server Actions 側で role チェックを二重に行い、UI が壊れていても RLS+role の両方で拒否される。

## 動作確認シナリオ

1. **問合せ一覧** → 「会員化前のみ」にチェック → 未対応の問合せが絞り込まれる
2. 問合せ詳細を開く → 「新規会員として作成」→ 氏名を入力 → 会員化
3. 会員詳細に飛び、申込履歴と活動履歴が表示されることを確認
4. **申込一覧** → 案件で絞り込み → 申込詳細を開く → ステータスを「対応中 → 完了」に変更
5. **案件マスタ** に admin でアクセス → 新規案件を追加 → サイドナビ「申込」絞り込みに反映
6. **ユーザー管理** に admin でアクセス → 自分以外のユーザーを sales → admin に昇格

## 既知の制約

- **問合せの新規作成** は UI から行えない(現状は移行スクリプト経由のみ)。Web フォームからの受け口は Phase 7 以降
- **申込の新規作成** も同様。会員詳細から作成できるよう Phase 6 で追加検討
- **案件マスタの無効化** は is_active=false で行うが、すでに申込が紐付いている場合の警告表示はない
- **ユーザー招待 UI** は実装せず、Supabase Studio に委譲(Phase 7 で簡易化検討)

## テスト

`tests/unit/phase5_domain.test.ts` で定数と CHECK 制約の整合性を保証。

```bash
pnpm test
```
