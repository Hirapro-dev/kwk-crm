# 移行時に手動適用する SQL

このディレクトリの SQL は `supabase/migrations/` に置かない補助スクリプト。
ローカルで Supabase Studio や psql から手動実行する想定。

## activities_drop_indexes.sql / activities_recreate_indexes.sql

仕様書 §6.1 Phase 3。120万件投入時の高速化:

1. `activities_drop_indexes.sql` を実行(インデックス削除、PK/UNIQUE は残す)
2. `pnpm migrate:activities` を実行
3. `activities_recreate_indexes.sql` を実行(インデックス再構築 + ANALYZE)

## 性能計測

仕様書 §10 Phase 3:「会員別タイムライン1秒以内」検証用クエリ:

```sql
EXPLAIN ANALYZE
SELECT *
FROM public.activities
WHERE member_id = 'K-0000001'
  AND deleted_at IS NULL
ORDER BY registered_datetime DESC
LIMIT 50;
```

- Index Scan を使えていれば OK
- Seq Scan になっていれば ANALYZE 不足または索引未作成
