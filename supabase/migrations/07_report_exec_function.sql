-- ============================================================================
-- レポート用 SQL 実行関数(仕様書 §9.8)
-- 配置: supabase/migrations/07_report_exec_function.sql
-- 前提: 01_schema.sql / 02a_rls_policies.sql / 05_reports_schema.sql 適用済み
-- ============================================================================
--
-- レポートビルダーが構築した SELECT 文を実行し、結果を jsonb 配列で返す。
--
-- 重要な安全保証:
--   1. SECURITY INVOKER: 呼び出しユーザーの権限で実行 → RLS が効く(仕様書 §9.14)
--   2. statement_timeout 30 秒: 重いクエリで DB を占有しない
--   3. 関数自体は SELECT 専用: 内部で EXECUTE する SQL に DML/DDL が混ざらないよう、
--      呼び出し側(builder_v2.ts)で SELECT のみを生成することを契約する
--
-- 注意:
--   - SQL 文字列はホワイトリスト方式で生成されている前提
--   - 値はバインドパラメータで渡される(params配列)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.exec_report_sql(
  query_sql text,
  query_params jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET statement_timeout = '30s'
SET search_path = public
AS $$
DECLARE
  result jsonb;
  final_sql text;
  param_count int;
  i int;
  bound_args text[];
BEGIN
  -- SELECT 以外を拒否(セキュリティガード)
  IF query_sql !~* '^(SET LOCAL statement_timeout\s*=\s*\d+\s*;\s*)?SELECT' THEN
    RAISE EXCEPTION 'exec_report_sql は SELECT 文のみ実行可能です';
  END IF;
  -- セミコロン以降の追加文を拒否(コメント・複文インジェクション防止)
  IF query_sql ~ ';\s*[^;\s].*\S' THEN
    RAISE EXCEPTION '不正な SQL: セミコロンを含む複文は許可されません';
  END IF;

  param_count := jsonb_array_length(query_params);

  -- パラメータを文字列配列に展開
  bound_args := ARRAY[]::text[];
  IF param_count > 0 THEN
    FOR i IN 0..(param_count - 1) LOOP
      bound_args := bound_args || (query_params->>i);
    END LOOP;
  END IF;

  -- 結果を JSON 配列として取得するため、ラップする
  -- EXECUTE は USING でパラメータ束縛できるが、最大引数数が制限されるため
  -- 一旦単純化して `format` を使い、サブクエリ + to_jsonb で集約する。
  final_sql := format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM (%s) t',
    query_sql
  );

  -- パラメータ束縛して実行
  -- bound_args が空でもエラーにならないよう分岐
  IF param_count = 0 THEN
    EXECUTE final_sql INTO result;
  ELSIF param_count = 1 THEN
    EXECUTE final_sql INTO result USING bound_args[1];
  ELSIF param_count = 2 THEN
    EXECUTE final_sql INTO result USING bound_args[1], bound_args[2];
  ELSIF param_count = 3 THEN
    EXECUTE final_sql INTO result USING bound_args[1], bound_args[2], bound_args[3];
  ELSIF param_count = 4 THEN
    EXECUTE final_sql INTO result USING bound_args[1], bound_args[2], bound_args[3], bound_args[4];
  ELSIF param_count = 5 THEN
    EXECUTE final_sql INTO result USING bound_args[1], bound_args[2], bound_args[3], bound_args[4], bound_args[5];
  ELSIF param_count = 6 THEN
    EXECUTE final_sql INTO result USING bound_args[1], bound_args[2], bound_args[3], bound_args[4], bound_args[5], bound_args[6];
  ELSIF param_count = 7 THEN
    EXECUTE final_sql INTO result USING bound_args[1], bound_args[2], bound_args[3], bound_args[4], bound_args[5], bound_args[6], bound_args[7];
  ELSIF param_count = 8 THEN
    EXECUTE final_sql INTO result USING bound_args[1], bound_args[2], bound_args[3], bound_args[4], bound_args[5], bound_args[6], bound_args[7], bound_args[8];
  ELSE
    -- パラメータ9個以上が必要なケースは現実的に少ない。必要なら拡張する。
    RAISE EXCEPTION 'パラメータ数が多すぎます(最大8): %', param_count;
  END IF;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- PostgREST から RPC 経由で呼べるようにする
GRANT EXECUTE ON FUNCTION public.exec_report_sql(text, jsonb) TO authenticated;

-- ============================================================================
-- 補助関数: レポートが「お気に入り」かどうか
-- favorited_by 配列に auth.uid() が含まれるかを返す
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_report_favorited(report_row public.reports)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT auth.uid() = ANY(report_row.favorited_by);
$$;
