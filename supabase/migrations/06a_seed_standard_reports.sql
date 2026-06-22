-- ============================================================================
-- 標準レポート 10 件 シード(仕様書 §9.12)
-- 配置: supabase/migrations/06a_seed_standard_reports.sql
-- 前提: 05_reports_schema.sql / 07_report_exec_function.sql 適用済み
--       admin ユーザーが少なくとも1名 public.users に存在すること
-- ============================================================================
--
-- created_by は最初の admin ユーザーを動的に選択する(`_admin_user_id` CTE)。
-- 既に同名の標準レポートがあれば、definition だけ更新する(冪等)。
-- ============================================================================

DO $$
DECLARE
  admin_id uuid;
  std_report_id uuid;
BEGIN
  -- 最初の admin ユーザーを取得。なければ何もしない。
  SELECT id INTO admin_id
  FROM public.users
  WHERE role = 'admin' AND deleted_at IS NULL
  ORDER BY created_at ASC
  LIMIT 1;

  IF admin_id IS NULL THEN
    RAISE NOTICE 'admin ユーザーが存在しないため標準レポートのシードをスキップ';
    RETURN;
  END IF;

  -- ============================================================================
  -- 1. 担当者別 今月活動件数 (RT08)
  -- ============================================================================
  INSERT INTO public.reports (name, description, report_type, definition, visibility, is_standard, created_by)
  VALUES (
    '担当者別 今月活動件数',
    '担当 × 大分類のクロス、対象=今月',
    'RT08',
    jsonb_build_object(
      'columns', jsonb_build_array(
        jsonb_build_object('id', 'c1', 'source', 'owner.full_name', 'label', '担当者'),
        jsonb_build_object('id', 'c2', 'source', 'act.d_bunrui', 'label', '大分類'),
        jsonb_build_object('id', 'c3', 'source', 'act.id', 'label', '活動件数', 'aggregate', 'count'),
        jsonb_build_object('id', 'c4', 'source', 'act.duration_minutes', 'label', '合計時間(分)', 'aggregate', 'sum')
      ),
      'filters', jsonb_build_object(
        'logic', 'AND',
        'conditions', jsonb_build_array(
          jsonb_build_object('field', 'act.registered_datetime', 'op', 'this_month')
        )
      ),
      'group_by', jsonb_build_array(
        jsonb_build_object('field', 'owner.full_name', 'level', 1),
        jsonb_build_object('field', 'act.d_bunrui', 'level', 2)
      ),
      'sort', jsonb_build_array(
        jsonb_build_object('field', 'act.id', 'direction', 'desc')
      )
    ),
    'team', true, admin_id
  )
  ON CONFLICT DO NOTHING;

  -- ============================================================================
  -- 2. 大口会員ランキング (RT02)
  -- ============================================================================
  INSERT INTO public.reports (name, description, report_type, definition, visibility, is_standard, created_by)
  VALUES (
    '大口会員ランキング',
    '総取引額 TOP100',
    'RT02',
    jsonb_build_object(
      'columns', jsonb_build_array(
        jsonb_build_object('id', 'c1', 'source', 'm.id', 'label', '会員ID'),
        jsonb_build_object('id', 'c2', 'source', 'm.name', 'label', '氏名'),
        jsonb_build_object('id', 'c3', 'source', 'owner.full_name', 'label', '担当'),
        jsonb_build_object('id', 'c4', 'source', 'm.total_amount', 'label', '総取引額')
      ),
      'sort', jsonb_build_array(
        jsonb_build_object('field', 'm.total_amount', 'direction', 'desc')
      ),
      'row_limit', 100
    ),
    'team', true, admin_id
  )
  ON CONFLICT DO NOTHING;

  -- ============================================================================
  -- 3. 案件別申込件数・金額 (RT10)
  -- ============================================================================
  INSERT INTO public.reports (name, description, report_type, definition, visibility, is_standard, created_by)
  VALUES (
    '案件別 申込件数・金額',
    '案件ごとの申込数・合計入金額',
    'RT10',
    jsonb_build_object(
      'columns', jsonb_build_array(
        jsonb_build_object('id', 'c1', 'source', 'p.name', 'label', '案件名'),
        jsonb_build_object('id', 'c2', 'source', 'p.category', 'label', 'カテゴリ'),
        jsonb_build_object('id', 'c3', 'source', 'a.id', 'label', '申込件数', 'aggregate', 'count_distinct'),
        jsonb_build_object('id', 'c4', 'source', 'a.payment_amount', 'label', '合計入金額', 'aggregate', 'sum')
      ),
      'group_by', jsonb_build_array(
        jsonb_build_object('field', 'p.name', 'level', 1),
        jsonb_build_object('field', 'p.category', 'level', 2)
      ),
      'sort', jsonb_build_array(
        jsonb_build_object('field', 'a.payment_amount', 'direction', 'desc')
      )
    ),
    'team', true, admin_id
  )
  ON CONFLICT DO NOTHING;

  -- ============================================================================
  -- 4. 未対応問合せリスト (RT09)
  -- ============================================================================
  INSERT INTO public.reports (name, description, report_type, definition, visibility, is_standard, created_by)
  VALUES (
    '未対応問合せリスト',
    'member_id 未紐付の問合せ一覧',
    'RT09',
    jsonb_build_object(
      'columns', jsonb_build_array(
        jsonb_build_object('id', 'c1', 'source', 'inq.id', 'label', '問合せID'),
        jsonb_build_object('id', 'c2', 'source', 'inq.registered_at', 'label', '登録日時'),
        jsonb_build_object('id', 'c3', 'source', 'f.name', 'label', 'フォーム'),
        jsonb_build_object('id', 'c4', 'source', 'inq.name', 'label', '氏名'),
        jsonb_build_object('id', 'c5', 'source', 'inq.email', 'label', 'メール')
      ),
      'filters', jsonb_build_object(
        'logic', 'AND',
        'conditions', jsonb_build_array(
          jsonb_build_object('field', 'inq.member_id', 'op', 'is_null')
        )
      ),
      'sort', jsonb_build_array(
        jsonb_build_object('field', 'inq.registered_at', 'direction', 'desc')
      )
    ),
    'team', true, admin_id
  )
  ON CONFLICT DO NOTHING;

  -- ============================================================================
  -- 5. 入金予定リスト(今月) (RT06)
  -- ============================================================================
  INSERT INTO public.reports (name, description, report_type, definition, visibility, is_standard, created_by)
  VALUES (
    '入金予定リスト(今月)',
    '今月中の入金予定日を持つ申込',
    'RT06',
    jsonb_build_object(
      'columns', jsonb_build_array(
        jsonb_build_object('id', 'c1', 'source', 'a.id', 'label', '申込ID'),
        jsonb_build_object('id', 'c2', 'source', 'm.name', 'label', '会員'),
        jsonb_build_object('id', 'c3', 'source', 'p.name', 'label', '案件'),
        jsonb_build_object('id', 'c4', 'source', 'a.scheduled_payment_date', 'label', '入金予定日'),
        jsonb_build_object('id', 'c5', 'source', 'a.scheduled_amount', 'label', '予定額'),
        jsonb_build_object('id', 'c6', 'source', 'a.status', 'label', 'ステータス')
      ),
      'filters', jsonb_build_object(
        'logic', 'AND',
        'conditions', jsonb_build_array(
          jsonb_build_object('field', 'a.scheduled_payment_date', 'op', 'this_month')
        )
      ),
      'sort', jsonb_build_array(
        jsonb_build_object('field', 'a.scheduled_payment_date', 'direction', 'asc')
      )
    ),
    'team', true, admin_id
  )
  ON CONFLICT DO NOTHING;

  -- ============================================================================
  -- 6. 90日以上活動なし会員 (RT02)
  -- ============================================================================
  INSERT INTO public.reports (name, description, report_type, definition, visibility, is_standard, created_by)
  VALUES (
    '90日以上活動なし会員',
    '最終活動日が90日以上前の会員',
    'RT02',
    jsonb_build_object(
      'columns', jsonb_build_array(
        jsonb_build_object('id', 'c1', 'source', 'm.id', 'label', '会員ID'),
        jsonb_build_object('id', 'c2', 'source', 'm.name', 'label', '氏名'),
        jsonb_build_object('id', 'c3', 'source', 'owner.full_name', 'label', '担当'),
        jsonb_build_object('id', 'c4', 'source', 'acts.registered_datetime', 'label', '最終活動日', 'aggregate', 'max'),
        jsonb_build_object('id', 'c5', 'source', 'm.total_amount', 'label', '総取引額')
      ),
      'sort', jsonb_build_array(
        jsonb_build_object('field', 'm.total_amount', 'direction', 'desc')
      )
    ),
    'team', true, admin_id
  )
  ON CONFLICT DO NOTHING;
  -- 備考: 「90日以上前」フィルタは max(acts.registered_datetime) ベースの HAVING が必要だが、
  --       現行ビルダーは HAVING の直接編集 UI を持たないため、結果テーブルから目視で確認する想定。

  -- ============================================================================
  -- 7. 担当未割当の大口会員 (RT02)
  -- ============================================================================
  INSERT INTO public.reports (name, description, report_type, definition, visibility, is_standard, created_by)
  VALUES (
    '担当未割当の大口会員',
    'owner_id IS NULL かつ 総取引額 >= 1,000万',
    'RT02',
    jsonb_build_object(
      'columns', jsonb_build_array(
        jsonb_build_object('id', 'c1', 'source', 'm.id', 'label', '会員ID'),
        jsonb_build_object('id', 'c2', 'source', 'm.name', 'label', '氏名'),
        jsonb_build_object('id', 'c3', 'source', 'm.total_amount', 'label', '総取引額'),
        jsonb_build_object('id', 'c4', 'source', 'm.registered_at', 'label', '登録日時')
      ),
      'filters', jsonb_build_object(
        'logic', 'AND',
        'conditions', jsonb_build_array(
          jsonb_build_object('field', 'm.owner_id', 'op', 'is_null'),
          jsonb_build_object('field', 'm.total_amount', 'op', 'gte', 'value', 10000000)
        )
      ),
      'sort', jsonb_build_array(
        jsonb_build_object('field', 'm.total_amount', 'direction', 'desc')
      )
    ),
    'team', true, admin_id
  )
  ON CONFLICT DO NOTHING;

  -- ============================================================================
  -- 8. 月次新規問合せ件数(フォーム別) (RT09)
  -- ============================================================================
  INSERT INTO public.reports (name, description, report_type, definition, visibility, is_standard, created_by)
  VALUES (
    '月次新規問合せ件数(フォーム別)',
    'フォーム × 月で件数集計',
    'RT09',
    jsonb_build_object(
      'columns', jsonb_build_array(
        jsonb_build_object('id', 'c1', 'source', 'f.name', 'label', 'フォーム'),
        jsonb_build_object('id', 'c2', 'source', 'inq.registered_at', 'label', '月'),
        jsonb_build_object('id', 'c3', 'source', 'inq.id', 'label', '件数', 'aggregate', 'count')
      ),
      'group_by', jsonb_build_array(
        jsonb_build_object('field', 'f.name', 'level', 1),
        jsonb_build_object('field', 'inq.registered_at', 'level', 2)
      ),
      'sort', jsonb_build_array(
        jsonb_build_object('field', 'inq.registered_at', 'direction', 'desc')
      )
    ),
    'team', true, admin_id
  )
  ON CONFLICT DO NOTHING;

  -- ============================================================================
  -- 9. 担当別 活動分類サマリ (RT08)
  -- ============================================================================
  INSERT INTO public.reports (name, description, report_type, definition, visibility, is_standard, created_by)
  VALUES (
    '担当別 活動分類サマリ',
    '担当 × 大分類 × 中分類の件数・時間集計',
    'RT08',
    jsonb_build_object(
      'columns', jsonb_build_array(
        jsonb_build_object('id', 'c1', 'source', 'owner.full_name', 'label', '担当者'),
        jsonb_build_object('id', 'c2', 'source', 'act.d_bunrui', 'label', '大分類'),
        jsonb_build_object('id', 'c3', 'source', 'act.m_bunrui', 'label', '中分類'),
        jsonb_build_object('id', 'c4', 'source', 'act.id', 'label', '件数', 'aggregate', 'count'),
        jsonb_build_object('id', 'c5', 'source', 'act.duration_minutes', 'label', '合計時間(分)', 'aggregate', 'sum')
      ),
      'group_by', jsonb_build_array(
        jsonb_build_object('field', 'owner.full_name', 'level', 1),
        jsonb_build_object('field', 'act.d_bunrui', 'level', 2),
        jsonb_build_object('field', 'act.m_bunrui', 'level', 3)
      ),
      'sort', jsonb_build_array(
        jsonb_build_object('field', 'act.id', 'direction', 'desc')
      )
    ),
    'team', true, admin_id
  )
  ON CONFLICT DO NOTHING;

  -- ============================================================================
  -- 10. 申込ステータス分布 (RT06)
  -- ============================================================================
  INSERT INTO public.reports (name, description, report_type, definition, visibility, is_standard, created_by)
  VALUES (
    '申込ステータス分布',
    'ステータス × 案件のクロス集計',
    'RT06',
    jsonb_build_object(
      'columns', jsonb_build_array(
        jsonb_build_object('id', 'c1', 'source', 'a.status', 'label', 'ステータス'),
        jsonb_build_object('id', 'c2', 'source', 'p.name', 'label', '案件'),
        jsonb_build_object('id', 'c3', 'source', 'a.id', 'label', '件数', 'aggregate', 'count'),
        jsonb_build_object('id', 'c4', 'source', 'a.payment_amount', 'label', '合計入金額', 'aggregate', 'sum')
      ),
      'group_by', jsonb_build_array(
        jsonb_build_object('field', 'a.status', 'level', 1),
        jsonb_build_object('field', 'p.name', 'level', 2)
      ),
      'sort', jsonb_build_array(
        jsonb_build_object('field', 'a.id', 'direction', 'desc')
      )
    ),
    'team', true, admin_id
  )
  ON CONFLICT DO NOTHING;

  RAISE NOTICE '標準レポート 10 件のシード完了(admin_id=%)', admin_id;
END;
$$;
