# 移行スクリプト共通ライブラリ

仕様書 §6 に従い、各CSVファイルに対する移行ロジックは `scripts/migrate/0X_*.ts` に配置する。

本 `lib/` 配下には以下の共通ユーティリティを Phase 1 以降で実装する:

- `csv.ts`: CSV パーサ(UTF-8 with BOM 対応)
- `owner_resolver.ts`: 「永久担当」氏名 → users.id 解決ロジック
   - users.full_name 完全一致 → `last_name + first_name` → 姓のみ部分一致の順
- `phone_normalizer.ts`: 電話番号フラグ抽出(架電NG 等)
- `datetime_parser.ts`: 日本語形式の日時パース
- `error_writer.ts`: エラーレコードのCSV出力(`errors/` 配下)
- `chunk.ts`: 5万件ずつの COPY 投入ヘルパ(Activity 120万件用)

すべての移行スクリプトは以下を満たすこと(仕様書 §6.2):

- `--dry-run` フラグ対応
- 進捗ログ出力
- エラーレコードを `errors/` にCSV保存
- 多重実行可能(冪等): `ON CONFLICT (id) DO UPDATE`
