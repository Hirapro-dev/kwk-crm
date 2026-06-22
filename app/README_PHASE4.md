# Phase 4: 中核UI(会員 / 活動 / ダッシュボード)

仕様書 §8 / §10 Phase 4 に対応。Phase 3 までのデータ移行後に動作確認可能。

## 実装範囲

| URL | 役割 | 実装ファイル |
|---|---|---|
| `/` | ダッシュボード | `app/(app)/page.tsx` |
| `/members` | 会員一覧(検索・フィルタ・ページネーション) | `app/(app)/members/page.tsx` |
| `/members/[id]` | 会員詳細(基本情報 + 活動タイムライン + 活動入力) | `app/(app)/members/[id]/page.tsx` |
| `/activities` | 活動一覧 + 上部固定入力フォーム(中核画面) | `app/(app)/activities/page.tsx` |

## 主要コンポーネント

```
components/
├── ui/                    ← shadcn/ui 相当の最小プリミティブ
│   ├── button.tsx
│   ├── input.tsx
│   ├── textarea.tsx
│   ├── select.tsx
│   ├── card.tsx
│   ├── badge.tsx
│   ├── table.tsx
│   ├── label.tsx
│   └── pagination-link.tsx
├── layout/
│   └── SidebarNav.tsx     ← アクティブ判定付きの強化版サイドナビ(将来用)
└── activities/
    ├── ActivityForm.tsx       ← 活動入力フォーム(主役・仕様書 §8.2)
    └── ActivityTimeline.tsx   ← タイムライン表示
```

## ドメインロジック層

UI から DB を直接叩かず、`lib/domain/` を経由(仕様書 §12.1):

```
lib/domain/
├── types.ts             ← AppUser / Member / Activity 等の軽量型
├── auth.ts              ← getCurrentUser()(未ログインは /login へ)
├── members.ts           ← listMembers / getMember / 検索
├── activities.ts        ← listActivities / 大分類抽出 / 中小分類サジェスト
├── activity_schema.ts   ← Zod スキーマ(仕様書 §12.1)
├── activity_actions.ts  ← Server Action: createActivity
└── dashboard.ts         ← getMyDashboardStats / getMyRecentActivities
```

## 仕様書 §8.2「3クリック以内アクセス」の実現

- グローバル `/activities` の上部に **常に開いた** 状態で `ActivityForm` を配置
- 会員詳細 `/members/[id]` でも `ActivityForm fixedMemberId={member.id}` で即記録可能
- ダッシュボードからは「最新活動 → 1クリックで会員詳細 → 即入力欄」

## 仕様書 §8.3 活動分類(D/M/S)

- 大分類はプルダウン(`getDBunruiList()` で既存値の重複排除を取得)
- 中・小分類は `<datalist>` を使った自由入力(既存値からサジェスト)
- 完全な分類マスタテーブルは未作成。Phase 7 で `lookup_activity_classification` 化を検討

## Phase 0 プレースホルダの扱い

Phase 0 で作った以下のスケルトンは Phase 4 で実装に置き換えた。
退避版は `.phase0.bak` 拡張子で残してある(削除可):

```
app/(app)/page.tsx.phase0.bak
app/(app)/members/page.tsx.phase0.bak
app/(app)/activities/page.tsx.phase0.bak
```

## 動作確認手順

```bash
# 0. Supabase に Phase 0〜3 のマイグレーションと移行データが入っていること
# 1. .env.local 設定済み
pnpm install
pnpm dev
# → http://localhost:3000
```

確認シナリオ:

1. /login でログイン
2. ダッシュボードに自分の今日の活動が出る(初回は 0 件)
3. 「活動履歴」へ移動 → 上部フォームから直接活動を1件登録 → 一覧に即反映
4. 「会員」へ移動 → 検索 / 担当絞り込み → 会員IDをクリック
5. 会員詳細でタイムラインを見ながら、その会員紐付けで活動を追加
6. ダッシュボードに戻ると統計が更新されている

## 既知の制約・Phase 5 以降への課題

- **検索精度**: `phone1` 検索は前方一致になっていない(ilike `%xxx%`)。性能対策として `pg_trgm` インデックスや前方一致専用列の検討余地あり
- **担当者プルダウン**: `MembersFilterBar` の owner プルダウンは「自分」「Free」「すべて」のみ。他の従業員での絞り込みは Phase 5 で追加
- **楽観的更新**: 活動入力後に Server Action 完了を待っているため、若干のラグあり。`useOptimistic` 導入は Phase 7 で
- **活動編集・削除**: 現在は新規作成のみ。Phase 5 で `updateActivity` / `softDeleteActivity` を追加
- **問合せ・申込画面**: 仕様書 §8.1 にあるが Phase 5 の範囲
- **レポート機能**: Phase 6 でビルダーごと実装

## RLS の効き目を確認するクエリ

```sql
-- 任意の sales ユーザーの JWT で実行:
SELECT id, name, owner_id FROM public.members LIMIT 10;
-- → owner_id が自分か NULL の会員しか返らない(仕様書 §7.2)
```

## テスト

```bash
pnpm test
# 新規追加: tests/unit/activity_schema.test.ts
```
