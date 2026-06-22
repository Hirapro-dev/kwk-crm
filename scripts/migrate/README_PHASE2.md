# Phase 2: コアデータ移行

仕様書 §6.1 Phase 2 に対応。マスタ(Phase 1)投入後に実行する。

## スクリプト一覧

| スクリプト | 入力CSV | 出力テーブル | 件数(目安) |
|---|---|---|---|
| `04_members.ts` | `会員情報.csv` | `members` | 23,580 |
| `05_inquiries.ts` | `KAWARA版関連.csv` + `機密保持_CP.csv` | `inquiries` | 8,443 |
| `06_applications.ts` | `申し込み情報.csv` | `applications` | 4,387 |

## 実行順序(重要)

依存関係があるため必ずこの順で実行する:

```bash
# Phase 1 完了確認(マスタが投入済みであること)
pnpm tsx scripts/migrate/verify.ts

# Phase 2: dry-run で全体検証
pnpm migrate:members -- --dry-run
pnpm migrate:inquiries -- --dry-run
pnpm migrate:applications -- --dry-run

# Phase 2: 本投入
pnpm migrate:members         # 先に会員を入れる(applications の FK 元)
pnpm migrate:inquiries       # 会員紐付け済の問合せを反映するため2番目
pnpm migrate:applications    # member_id/project_id を解決して投入

# 検証
pnpm tsx scripts/migrate/verify.ts
```

## クレンジング規則(仕様書 §6.3)

### 会員(`04_members.ts`)
- 電話番号末尾の「架電NG」等のフラグを抽出 → `do_not_call=true`、`extra._original_phone` に原文保持
- `email1`/`2`/`3` 空文字 → NULL
- 永久担当 "Free" → `owner_id=NULL`、`owner_name_raw="Free"` 保持
- 永久担当 氏名 → users 解決(4段階フォールバック、`OwnerResolver` 参照)
- 登録日時の和暦/スラッシュ形式パース、失敗時は `extra.original_registered_at` に原文保持
- 60列以上の「案件別利用額」横持ち列は `extra.legacy_breakdown` に jsonb として保管(縦持ち化は将来)

### 問合せ(`05_inquiries.ts`)
- 2ファイル統合、TA-ID で一意化(重複時は後勝ち、`extra` はマージ)
- フォーム種別 → `form_id` 解決、未マッチは `extra._unmatched_form_name` に記録
- 機密保持_CP.csv の `####...###` 埋め値は廃棄、列名のみ `extra._hash_filled_columns` に記録
- フォーム固有項目(不安要素、暗号資産、ADA詳細、投資履歴…)は元列名で `extra` 内に格納

### 申込(`06_applications.ts`)
- `案件名` → `projects.id` 解決、見つからない場合は **errors.csv に記録してスキップ**
- `会員ID` → `members.id` 正規化(K-XXXXXXX 形式)、NOT NULL のため未解決はエラー
- 担当者・申込獲得者の氏名 → users 解決(失敗時は raw 列に保持)
- ステータス・入出金区分の CHECK 制約違反値は NULL にして `extra._invalid_*` に原値保持
- 案件固有項目(コイン数、レート、ボーナス、配当比率)は元列名で `extra` 内に格納

## ID 体系の正規化

`scripts/migrate/lib/id_normalizers.ts` で統一処理:

| 入力例 | 出力 |
|---|---|
| `K0012345` / `K-12345` / `12345` | `K-0012345` |
| `M0012345` / `M-12345` | `M-0012345` |
| `TA0000123` / `TA-123` | `TA-0000123` |

## 投入順の理由

```
users  ←─┐
         ├─ members  ←──┐
projects ┤              ├─ applications
         │              │
         └─ activities ─┘
forms ────── inquiries ─┘
```

- `applications` は `members.id` / `projects.id` への FK があるため、両マスタ確定後にしか投入できない
- `inquiries` は `member_id` 任意の FK だが、解決精度を上げるため `members` 投入後に処理する
- `activities`(Phase 3)は `users.id` と `members.id` を参照

## エラー対応

エラーが出た場合の標準フロー:

1. `errors/<script>_errors.csv` を Excel で開く
2. `_error` 列で原因確認
3. CSV 側を修正、または lib/normalizers.ts のルール拡張
4. **冪等性により再実行可能**(`ON CONFLICT DO UPDATE`)

## 既知の制約

- `applications.inquiry_id` は最大7桁の TA-ID にしか対応しない(8桁以上の元データがある場合は要調整)
- 機密保持_CP.csv で `####` 埋めの列は復元不能(元 Salesforce で参照権限が無かった列)
- 会員CSVの「案件別利用額」60列以上は縦持ち化せず JSONB のみ。将来 `transactions` テーブル化予定(仕様書 §14)
