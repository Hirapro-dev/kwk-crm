-- =============================================================================
-- Phase 1: オブジェクト管理マスタ (CLAUDE.md §5.8 / §5.9)
-- =============================================================================
-- 目的:
--   管理者が /settings/objects でオブジェクト × カラムの表示制御を行えるよう、
--   メタデータ専用の2テーブルを追加する。
--
-- スコープ (Phase 1):
--   - メタデータ管理のみ。実画面 (members 一覧等) への動的反映は Phase 2 以降。
--   - 初期データとして、現状の主要オブジェクト + その代表カラムをシード。
--
-- 影響範囲:
--   - 新規テーブル 2 つを追加するのみ。既存テーブルは触らない。
--   - RLS は admin/manager/sales/viewer 全員 SELECT、admin のみ UPDATE/INSERT/DELETE。
-- =============================================================================

-- ========================================================
-- 1) object_definitions
-- ========================================================
CREATE TABLE IF NOT EXISTS public.object_definitions (
  id            text PRIMARY KEY,                                -- 物理テーブル名 (members 等)
  label         text NOT NULL,                                   -- 表示名 (顧客情報 等)
  icon_label    text,                                            -- リストヘッダー3文字 (MEM)
  icon_color    text,                                            -- カラー (#1589ee)
  sort_order    int NOT NULL DEFAULT 100,
  is_system     boolean NOT NULL DEFAULT false,                  -- システム標準 (削除不可)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_object_definitions_sort ON public.object_definitions(sort_order);

CREATE TRIGGER trg_object_definitions_updated_at
  BEFORE UPDATE ON public.object_definitions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========================================================
-- 2) field_definitions
-- ========================================================
CREATE TABLE IF NOT EXISTS public.field_definitions (
  id                  bigserial PRIMARY KEY,
  object_id           text NOT NULL REFERENCES public.object_definitions(id) ON DELETE CASCADE,
  field_name          text NOT NULL,                              -- DB カラム名
  label               text,                                       -- 表示ラベル (NULL なら field_name)
  data_type           text NOT NULL DEFAULT 'text'
                      CHECK (data_type IN ('text','number','date','datetime','boolean','enum','jsonb')),
  is_visible_list     boolean NOT NULL DEFAULT true,
  is_visible_detail   boolean NOT NULL DEFAULT true,
  is_system           boolean NOT NULL DEFAULT false,             -- 削除不可
  is_custom           boolean NOT NULL DEFAULT false,             -- CSV取込で自動追加 or 管理者が追加
  sort_order_list     int NOT NULL DEFAULT 100,
  sort_order_detail   int NOT NULL DEFAULT 100,
  description         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (object_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_field_definitions_object ON public.field_definitions(object_id);
CREATE INDEX IF NOT EXISTS idx_field_definitions_sort_list   ON public.field_definitions(object_id, sort_order_list);
CREATE INDEX IF NOT EXISTS idx_field_definitions_sort_detail ON public.field_definitions(object_id, sort_order_detail);

CREATE TRIGGER trg_field_definitions_updated_at
  BEFORE UPDATE ON public.field_definitions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========================================================
-- 3) RLS: 全員 SELECT、admin のみ INSERT/UPDATE/DELETE
-- ========================================================
ALTER TABLE public.object_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_definitions  ENABLE ROW LEVEL SECURITY;

-- object_definitions
DROP POLICY IF EXISTS object_definitions_select ON public.object_definitions;
CREATE POLICY object_definitions_select ON public.object_definitions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS object_definitions_modify ON public.object_definitions;
CREATE POLICY object_definitions_modify ON public.object_definitions
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin' AND u.deleted_at IS NULL)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin' AND u.deleted_at IS NULL)
  );

-- field_definitions
DROP POLICY IF EXISTS field_definitions_select ON public.field_definitions;
CREATE POLICY field_definitions_select ON public.field_definitions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS field_definitions_modify ON public.field_definitions;
CREATE POLICY field_definitions_modify ON public.field_definitions
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin' AND u.deleted_at IS NULL)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin' AND u.deleted_at IS NULL)
  );

-- ========================================================
-- 4) 初期シード: 7つのオブジェクト
-- ========================================================
INSERT INTO public.object_definitions (id, label, icon_label, icon_color, sort_order, is_system) VALUES
  ('members',      '顧客情報',   'MEM', '#1589ee', 10, true),
  ('inquiries',    '問合せ',     'INQ', '#1589ee', 20, true),
  ('applications', '申込',       'APP', '#1589ee', 30, true),
  ('projects',     '案件マスタ', 'PRJ', '#04844b', 40, true),
  ('activities',   '活動履歴',   'ACT', '#1589ee', 50, true),
  ('users',        'ユーザー',   'USR', '#04844b', 60, true),
  ('forms',        'フォーム',   'FRM', '#9333ea', 70, true)
ON CONFLICT (id) DO NOTHING;

-- ========================================================
-- 5) 初期シード: 各オブジェクトの代表カラム
--    (すべて is_system=true、is_custom=false で投入)
-- ========================================================

-- members
INSERT INTO public.field_definitions (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system, sort_order_list, sort_order_detail) VALUES
  ('members', 'id',                  '会員ID',       'text',     true,  true,  true, 10,  10),
  ('members', 'name',                '氏名',         'text',     true,  true,  true, 20,  20),
  ('members', 'name_kana',           '氏名(カナ)',   'text',     false, true,  true, 30,  30),
  ('members', 'owner_id',            '担当',         'text',     true,  true,  true, 40,  40),
  ('members', 'email1',              'メール1',      'text',     true,  true,  true, 50,  50),
  ('members', 'email2',              'メール2',      'text',     false, true,  true, 60,  60),
  ('members', 'email3',              'メール3',      'text',     false, true,  true, 70,  70),
  ('members', 'phone1',              '電話',         'text',     true,  true,  true, 80,  80),
  ('members', 'postal_code',         '郵便番号',     'text',     false, true,  true, 90,  90),
  ('members', 'address',             '住所',         'text',     false, true,  true, 100, 100),
  ('members', 'customer_type',       '顧客種別',     'text',     true,  true,  true, 110, 110),
  ('members', 'total_amount',        '総取引額',     'number',   true,  true,  true, 120, 120),
  ('members', 'total_paid_amount',   '総入金額',     'number',   false, true,  true, 130, 130),
  ('members', 'total_used_amount',   '総利用額',     'number',   false, true,  true, 140, 140),
  ('members', 'registered_at',       '登録日時',     'datetime', true,  true,  true, 150, 150),
  ('members', 'first_contact_date',  '初回接触日',   'date',     false, true,  true, 160, 160),
  ('members', 'birthdate',           '生年月日',     'date',     false, true,  true, 170, 170),
  ('members', 'gender',              '性別',         'text',     false, true,  true, 180, 180)
ON CONFLICT (object_id, field_name) DO NOTHING;

-- inquiries
INSERT INTO public.field_definitions (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system, sort_order_list, sort_order_detail) VALUES
  ('inquiries', 'id',            '問合せID',     'text',     true,  true,  true, 10,  10),
  ('inquiries', 'registered_at', '登録日時',     'datetime', true,  true,  true, 20,  20),
  ('inquiries', 'form_id',       'フォーム',     'enum',     true,  true,  true, 30,  30),
  ('inquiries', 'member_id',     '会員ID',       'text',     false, true,  true, 40,  40),
  ('inquiries', 'name',          '氏名',         'text',     true,  true,  true, 50,  50),
  ('inquiries', 'name_kana',     '氏名(カナ)',   'text',     false, true,  true, 60,  60),
  ('inquiries', 'email',         'メール',       'text',     true,  true,  true, 70,  70),
  ('inquiries', 'phone',         '電話',         'text',     true,  true,  true, 80,  80),
  ('inquiries', 'postal_code',   '郵便番号',     'text',     false, true,  true, 90,  90),
  ('inquiries', 'address',       '住所',         'text',     false, true,  true, 100, 100),
  ('inquiries', 'ad_id',         '広告ID',       'text',     false, true,  true, 110, 110)
ON CONFLICT (object_id, field_name) DO NOTHING;

-- applications
INSERT INTO public.field_definitions (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system, sort_order_list, sort_order_detail) VALUES
  ('applications', 'id',                     '申込ID',           'text',     true,  true,  true, 10,  10),
  ('applications', 'application_date',       '申込日',           'date',     true,  true,  true, 20,  20),
  ('applications', 'member_id',              '会員',             'text',     true,  true,  true, 30,  30),
  ('applications', 'project_id',             '案件',             'text',     true,  true,  true, 40,  40),
  ('applications', 'status',                 'ステータス',       'enum',     true,  true,  true, 50,  50),
  ('applications', 'flow_type',              '区分',             'enum',     true,  true,  true, 60,  60),
  ('applications', 'payment_amount',         '入金額',           'number',   true,  true,  true, 70,  70),
  ('applications', 'payment_date',           '入金日',           'date',     false, true,  true, 80,  80),
  ('applications', 'owner_id',               '担当',             'text',     true,  true,  true, 90,  90),
  ('applications', 'acquirer_id',            '申込獲得者',       'text',     false, true,  true, 100, 100),
  ('applications', 'scheduled_payment_date', '入金予定日',       'date',     false, true,  true, 110, 110),
  ('applications', 'scheduled_amount',       '入金予定額',       'number',   false, true,  true, 120, 120),
  ('applications', 'withdrawal_amount',      '出金額',           'number',   false, true,  true, 130, 130),
  ('applications', 'withdrawal_date',        '出金日',           'date',     false, true,  true, 140, 140),
  ('applications', 'contract_period',        '契約期間',         'text',     false, true,  true, 150, 150)
ON CONFLICT (object_id, field_name) DO NOTHING;

-- projects
INSERT INTO public.field_definitions (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system, sort_order_list, sort_order_detail) VALUES
  ('projects', 'id',          '案件ID',   'text',    true,  true, true, 10, 10),
  ('projects', 'name',        '案件名',   'text',    true,  true, true, 20, 20),
  ('projects', 'description', '説明',     'text',    true,  true, true, 30, 30),
  ('projects', 'is_active',   '有効',     'boolean', true,  true, true, 40, 40)
ON CONFLICT (object_id, field_name) DO NOTHING;

-- activities
INSERT INTO public.field_definitions (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system, sort_order_list, sort_order_detail) VALUES
  ('activities', 'id',                  '活動ID',     'number',   false, true, true, 10, 10),
  ('activities', 'registered_datetime', '日時',       'datetime', true,  true, true, 20, 20),
  ('activities', 'owner_id',            '対応者',     'text',     true,  true, true, 30, 30),
  ('activities', 'member_id',           '会員',       'text',     true,  true, true, 40, 40),
  ('activities', 'd_bunrui',            '接触種別',   'text',     true,  true, true, 50, 50),
  ('activities', 'm_bunrui',            '接触内容',   'text',     true,  true, true, 60, 60),
  ('activities', 's_bunrui',            '状態',       'text',     true,  true, true, 70, 70),
  ('activities', 'description',         'コメント',   'text',     true,  true, true, 80, 80)
ON CONFLICT (object_id, field_name) DO NOTHING;

-- users
INSERT INTO public.field_definitions (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system, sort_order_list, sort_order_detail) VALUES
  ('users', 'id',           'ユーザーID',     'text',     false, true, true, 10, 10),
  ('users', 'full_name',    '氏名',           'text',     true,  true, true, 20, 20),
  ('users', 'email',        'メール',         'text',     true,  true, true, 30, 30),
  ('users', 'role',         '権限',           'enum',     true,  true, true, 40, 40),
  ('users', 'is_active',    '有効',           'boolean',  true,  true, true, 50, 50),
  ('users', 'legacy_sf_id', '旧Salesforce ID','text',     true,  true, true, 60, 60),
  ('users', 'created_at',   '登録日時',       'datetime', true,  true, true, 70, 70)
ON CONFLICT (object_id, field_name) DO NOTHING;

-- forms
INSERT INTO public.field_definitions (object_id, field_name, label, data_type, is_visible_list, is_visible_detail, is_system, sort_order_list, sort_order_detail) VALUES
  ('forms', 'id',          'フォームID',   'number',  true, true, true, 10, 10),
  ('forms', 'name',        'フォーム名',   'text',    true, true, true, 20, 20),
  ('forms', 'category',    'カテゴリ',     'text',    true, true, true, 30, 30),
  ('forms', 'description', '説明',         'text',    true, true, true, 40, 40),
  ('forms', 'is_active',   '有効',         'boolean', true, true, true, 50, 50)
ON CONFLICT (object_id, field_name) DO NOTHING;

-- ========================================================
-- 完了
-- ========================================================
-- 次のステップ (Phase 2 以降):
--   1. 各リスト画面のレンダリングを field_definitions ベースに変える
--   2. CSV取込時に新カラム検出 → field_definitions に is_custom=true で自動追加
--   3. 詳細画面の動的化
