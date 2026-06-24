/**
 * 全レポートタイプ(RT01-RT10)のスキーマ定義(仕様書 §9.3, §9.4)。
 *
 * Phase 0 で作成した `schema.ts` は RT02 のみだったため、本ファイルで全タイプを再定義する。
 * SQL Builder はこのファイルの定義に基づいてホワイトリストチェックを行う(仕様書 §9.8)。
 *
 * 設計:
 *   - 各テーブルにはユニークなエイリアスを付与(JOIN 時の名前衝突回避)
 *   - allowedJoins は LEFT JOIN を基本とする(右側 0 件でも左行を残す)
 *   - allowedFilters は filterable=true のカラムのみ
 *   - groupable=true のカラムは GROUP BY 候補
 */

import type { ReportTypeId } from './types';

export type DataType = 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'jsonb' | 'enum';

export interface AllowedColumnDef {
  /**
   * 論理ソース名。
   * - 通常カラム: 'alias.column' (例: 'm.name')
   * - extra jsonb キー (isExtra=true): 'alias.extra:key' (例: 'm.extra:investing_amount')
   *   コロン区切りにすることで SQL Builder 側で extra->>'key' 形式に展開する。
   */
  source: string;
  /** UI 表示ラベル */
  label: string;
  dataType: DataType;
  /** 集計関数を適用可能か(数値・日時・主キー等) */
  aggregatable?: boolean;
  /** フィルタの対象にできるか */
  filterable?: boolean;
  /** GROUP BY の対象にできるか */
  groupable?: boolean;
  /** ソートできるか */
  sortable?: boolean;
  /**
   * extra jsonb キーかどうか。
   * true の場合 SQL Builder は `alias.extra->>'key'` で展開し、データ型は常に text 扱い
   * (PostgreSQL の ->> 演算子は text を返すため)。集計やソートは text として実行される。
   */
  isExtra?: boolean;
}

export interface AllowedJoinDef {
  /** SQL で使うエイリアス('m' / 'owner' / 'apps' 等) */
  alias: string;
  /** 物理テーブル名 */
  table: string;
  /** JOIN 種別 */
  type: 'inner' | 'left';
  /** ON 句(SQL リテラル。値の差し込みはなく固定式のみ) */
  on: string;
}

export interface ReportTypeSchemaDef {
  reportType: ReportTypeId;
  baseTable: string;
  /** 主軸テーブルのエイリアス */
  baseAlias: string;
  /** 主軸テーブルにかかる WHERE(常に追加) */
  baseWhere: string[];
  allowedJoins: AllowedJoinDef[];
  allowedColumns: AllowedColumnDef[];
}

// ============================================================================
// 共通カラム集合(複数 RT で共有)
// ============================================================================

const MEMBER_COLUMNS = (alias: string): AllowedColumnDef[] => [
  { source: `${alias}.id`, label: '会員ID', dataType: 'text', filterable: true, groupable: true, sortable: true, aggregatable: true },
  { source: `${alias}.name`, label: '会員氏名', dataType: 'text', filterable: true, sortable: true, groupable: true },
  { source: `${alias}.name_kana`, label: '会員かな', dataType: 'text', filterable: true, sortable: true },
  { source: `${alias}.real_name`, label: '実質名義人', dataType: 'text', filterable: true },
  { source: `${alias}.email1`, label: 'Eメール1', dataType: 'text', filterable: true },
  { source: `${alias}.email2`, label: 'Eメール2', dataType: 'text', filterable: true },
  { source: `${alias}.email3`, label: 'Eメール3', dataType: 'text', filterable: true },
  { source: `${alias}.phone1`, label: '電話番号1', dataType: 'text', filterable: true },
  { source: `${alias}.do_not_call`, label: '架電NG', dataType: 'boolean', filterable: true, groupable: true },
  { source: `${alias}.postal_code`, label: '郵便番号', dataType: 'text', filterable: true },
  { source: `${alias}.address`, label: '住所', dataType: 'text', filterable: true },
  { source: `${alias}.customer_type`, label: '顧客種別', dataType: 'text', filterable: true, groupable: true, sortable: true },
  { source: `${alias}.owner_id`, label: '担当者ID', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.owner_name_raw`, label: 'プロテクト', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.regular_contact_id`, label: '定期連絡者ID', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.first_contact_date`, label: '初回接触日', dataType: 'date', filterable: true, sortable: true, groupable: true },
  { source: `${alias}.registered_at`, label: '登録日', dataType: 'datetime', filterable: true, sortable: true, groupable: true },
  { source: `${alias}.mailmag_registered_at`, label: 'メルマガ登録日時', dataType: 'datetime', filterable: true, sortable: true },
  { source: `${alias}.ad_id`, label: '広告ID', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.ad_medium`, label: '広告媒体名', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.info_acquired_points`, label: '個人情報取得ポイント', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.info_acquired_date`, label: '顧客情報取得日', dataType: 'date', filterable: true, sortable: true },
  { source: `${alias}.gender`, label: '性別', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.birthdate`, label: '生年月日', dataType: 'date', filterable: true, sortable: true },
  { source: `${alias}.referrer_name`, label: '紹介者氏名', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.affiliate_id`, label: 'ｱﾌｨﾘID', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.affiliate_name`, label: 'アフィリ名', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.total_amount`, label: '総合計額', dataType: 'number', filterable: true, sortable: true, aggregatable: true },
  { source: `${alias}.total_paid_amount`, label: '総合計実入金額', dataType: 'number', filterable: true, sortable: true, aggregatable: true },
  { source: `${alias}.total_used_amount`, label: '総利用額合計', dataType: 'number', filterable: true, sortable: true, aggregatable: true },
  { source: `${alias}.created_at`, label: '作成日時', dataType: 'datetime', filterable: true, sortable: true },
  { source: `${alias}.updated_at`, label: '更新日時', dataType: 'datetime', filterable: true, sortable: true },
];

const APP_COLUMNS = (alias: string): AllowedColumnDef[] => [
  { source: `${alias}.id`, label: '申込情報ID', dataType: 'text', filterable: true, sortable: true, aggregatable: true },
  { source: `${alias}.inquiry_id`, label: '問合せ管理ID', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.member_id`, label: '会員ID', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.project_id`, label: '投資案件', dataType: 'number', filterable: true, groupable: true },
  { source: `${alias}.application_date`, label: '申込日', dataType: 'date', filterable: true, sortable: true, groupable: true },
  { source: `${alias}.status`, label: 'ステータス', dataType: 'enum', filterable: true, groupable: true },
  { source: `${alias}.flow_type`, label: '入金/移動', dataType: 'enum', filterable: true, groupable: true },
  { source: `${alias}.owner_id`, label: '申込担当ID', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.owner_name_raw`, label: '申込プロテクト', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.acquirer_id`, label: '獲得者ID', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.acquirer_name_raw`, label: '申込獲得者', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.contract_sent_date`, label: '契約書送付日', dataType: 'date', filterable: true, sortable: true },
  { source: `${alias}.start_month`, label: '起算月', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.start_datetime`, label: '起算日時', dataType: 'datetime', filterable: true, sortable: true },
  { source: `${alias}.scheduled_payment_date`, label: '入金予定日', dataType: 'date', filterable: true, sortable: true, groupable: true },
  { source: `${alias}.scheduled_amount`, label: '入金予定額', dataType: 'number', filterable: true, sortable: true, aggregatable: true },
  { source: `${alias}.payment_date`, label: '入金日', dataType: 'date', filterable: true, sortable: true, groupable: true },
  { source: `${alias}.payment_amount`, label: '入金額', dataType: 'number', filterable: true, sortable: true, aggregatable: true },
  { source: `${alias}.crypto_excluded_amount`, label: '仮想通貨除外分', dataType: 'number', filterable: true, sortable: true, aggregatable: true },
  { source: `${alias}.yen_interest`, label: '円金利', dataType: 'number', filterable: true, sortable: true, aggregatable: true },
  { source: `${alias}.withdrawal_amount`, label: '出金額', dataType: 'number', filterable: true, sortable: true, aggregatable: true },
  { source: `${alias}.withdrawal_date`, label: '出金日', dataType: 'date', filterable: true, sortable: true },
  { source: `${alias}.transfer_date`, label: '資金移動日', dataType: 'date', filterable: true, sortable: true },
  { source: `${alias}.transfer_amount`, label: '資金移動額', dataType: 'number', filterable: true, sortable: true, aggregatable: true },
  { source: `${alias}.transfer_to`, label: '資金移動先', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.contract_period`, label: '契約期間', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.created_at`, label: '作成日時', dataType: 'datetime', filterable: true, sortable: true },
  { source: `${alias}.updated_at`, label: '更新日時', dataType: 'datetime', filterable: true, sortable: true },
];

const ACTIVITY_COLUMNS = (alias: string): AllowedColumnDef[] => [
  { source: `${alias}.id`, label: '対応歴ID', dataType: 'number', filterable: true, aggregatable: true },
  { source: `${alias}.legacy_sf_id`, label: '旧SF対応歴ID', dataType: 'text', filterable: true },
  { source: `${alias}.owner_id`, label: '対応担当ID', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.member_id`, label: '会員ID', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.created_by_id`, label: '作成者ID', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.todo_time`, label: 'TODO時間', dataType: 'number', filterable: true, sortable: true, aggregatable: true },
  { source: `${alias}.description`, label: '対応詳細', dataType: 'text', filterable: true },
  { source: `${alias}.d_bunrui`, label: '大分類', dataType: 'text', filterable: true, groupable: true, sortable: true },
  { source: `${alias}.m_bunrui`, label: '中分類', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.s_bunrui`, label: '小分類', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.registered_date`, label: '対応日', dataType: 'date', filterable: true, sortable: true, groupable: true },
  { source: `${alias}.registered_datetime`, label: '対応日時', dataType: 'datetime', filterable: true, sortable: true, groupable: true, aggregatable: true },
  { source: `${alias}.created_at`, label: '作成日時', dataType: 'datetime', filterable: true, sortable: true },
  { source: `${alias}.updated_at`, label: '更新日時', dataType: 'datetime', filterable: true, sortable: true },
];

const USER_COLUMNS = (alias: string): AllowedColumnDef[] => [
  { source: `${alias}.id`, label: '担当者ID', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.full_name`, label: '担当者氏名', dataType: 'text', filterable: true, sortable: true, groupable: true },
  { source: `${alias}.first_name`, label: '担当者名', dataType: 'text', filterable: true, sortable: true },
  { source: `${alias}.last_name`, label: '担当者姓', dataType: 'text', filterable: true, sortable: true },
  { source: `${alias}.email`, label: '担当メール', dataType: 'text', filterable: true },
  { source: `${alias}.role`, label: '権限', dataType: 'enum', filterable: true, groupable: true },
  { source: `${alias}.is_active`, label: '有効', dataType: 'boolean', filterable: true, groupable: true },
  { source: `${alias}.legacy_sf_id`, label: '旧SFユーザーID', dataType: 'text', filterable: true },
];

/** 定期連絡者 JOIN 用カラム(alias='rc'で使う) */
const REGULAR_CONTACT_COLUMNS = (alias: string): AllowedColumnDef[] => [
  { source: `${alias}.id`, label: '定期連絡者ID', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.full_name`, label: '定期連絡者氏名', dataType: 'text', filterable: true, sortable: true, groupable: true },
  { source: `${alias}.email`, label: '定期連絡者メール', dataType: 'text', filterable: true },
];

const PROJECT_COLUMNS = (alias: string): AllowedColumnDef[] => [
  { source: `${alias}.id`, label: '案件ID', dataType: 'text', filterable: true, groupable: true, sortable: true },
  { source: `${alias}.name`, label: '案件名', dataType: 'text', filterable: true, sortable: true, groupable: true },
  { source: `${alias}.description`, label: '案件説明', dataType: 'text', filterable: true },
  { source: `${alias}.is_active`, label: '有効', dataType: 'boolean', filterable: true, groupable: true },
];

const FORM_COLUMNS = (alias: string): AllowedColumnDef[] => [
  { source: `${alias}.id`, label: 'フォームID', dataType: 'number', filterable: true, groupable: true },
  { source: `${alias}.name`, label: 'フォーム名', dataType: 'text', filterable: true, sortable: true, groupable: true },
  { source: `${alias}.category`, label: 'フォームカテゴリ', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.description`, label: 'フォーム説明', dataType: 'text', filterable: true },
  { source: `${alias}.is_active`, label: '有効', dataType: 'boolean', filterable: true, groupable: true },
];

const INQUIRY_COLUMNS = (alias: string): AllowedColumnDef[] => [
  { source: `${alias}.id`, label: '問合せID', dataType: 'text', filterable: true, sortable: true, aggregatable: true },
  { source: `${alias}.form_id`, label: 'フォーム名', dataType: 'number', filterable: true, groupable: true },
  { source: `${alias}.member_id`, label: '会員ID', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.name`, label: '氏名', dataType: 'text', filterable: true, sortable: true },
  { source: `${alias}.name_kana`, label: '氏名かな', dataType: 'text', filterable: true },
  { source: `${alias}.email`, label: 'メールアドレス', dataType: 'text', filterable: true },
  { source: `${alias}.phone`, label: '電話番号', dataType: 'text', filterable: true },
  { source: `${alias}.postal_code`, label: '郵便番号', dataType: 'text', filterable: true },
  { source: `${alias}.address`, label: '住所', dataType: 'text', filterable: true },
  { source: `${alias}.ad_id`, label: '広告ID', dataType: 'text', filterable: true, groupable: true },
  { source: `${alias}.registered_at`, label: '登録日時', dataType: 'datetime', filterable: true, sortable: true, groupable: true },
  { source: `${alias}.created_at`, label: '作成日時', dataType: 'datetime', filterable: true, sortable: true },
  { source: `${alias}.updated_at`, label: '更新日時', dataType: 'datetime', filterable: true, sortable: true },
];

// ============================================================================
// 結合定義(共通)
// ============================================================================

const JOIN_MEMBER_TO_OWNER: AllowedJoinDef = {
  alias: 'owner',
  table: 'users',
  type: 'left',
  on: 'owner.id = m.owner_id',
};
const JOIN_MEMBER_TO_REGULAR_CONTACT: AllowedJoinDef = {
  alias: 'rc',
  table: 'users',
  type: 'left',
  on: 'rc.id = m.regular_contact_id',
};
const JOIN_APP_TO_MEMBER: AllowedJoinDef = {
  alias: 'm',
  table: 'members',
  type: 'left',
  on: 'm.id = a.member_id AND m.deleted_at IS NULL',
};
const JOIN_APP_TO_PROJECT: AllowedJoinDef = {
  alias: 'p',
  table: 'projects',
  type: 'left',
  on: 'p.id = a.project_id',
};
const JOIN_APP_TO_OWNER: AllowedJoinDef = {
  alias: 'owner',
  table: 'users',
  type: 'left',
  on: 'owner.id = a.owner_id',
};
const JOIN_ACT_TO_OWNER: AllowedJoinDef = {
  alias: 'owner',
  table: 'users',
  type: 'left',
  on: 'owner.id = act.owner_id',
};
const JOIN_ACT_TO_MEMBER: AllowedJoinDef = {
  alias: 'm',
  table: 'members',
  type: 'left',
  on: 'm.id = act.member_id AND m.deleted_at IS NULL',
};
const JOIN_INQ_TO_FORM: AllowedJoinDef = {
  alias: 'f',
  table: 'forms',
  type: 'left',
  on: 'f.id = inq.form_id',
};
const JOIN_INQ_TO_MEMBER: AllowedJoinDef = {
  alias: 'm',
  table: 'members',
  type: 'left',
  on: 'm.id = inq.member_id AND m.deleted_at IS NULL',
};

// ============================================================================
// RT01-RT10 定義
// ============================================================================

export const REPORT_SCHEMAS: Record<ReportTypeId, ReportTypeSchemaDef> = {
  // RT01: 会員一覧 — 1会員=1行
  RT01: {
    reportType: 'RT01',
    baseTable: 'members',
    baseAlias: 'm',
    baseWhere: ['m.deleted_at IS NULL'],
    allowedJoins: [JOIN_MEMBER_TO_OWNER, JOIN_MEMBER_TO_REGULAR_CONTACT],
    allowedColumns: [...MEMBER_COLUMNS('m'), ...USER_COLUMNS('owner'), ...REGULAR_CONTACT_COLUMNS('rc')],
  },

  // RT02: 会員サマリ ★最重要 — 1会員=1行(集計済)
  RT02: {
    reportType: 'RT02',
    baseTable: 'members',
    baseAlias: 'm',
    baseWhere: ['m.deleted_at IS NULL'],
    allowedJoins: [
      JOIN_MEMBER_TO_OWNER,
      JOIN_MEMBER_TO_REGULAR_CONTACT,
      {
        alias: 'apps',
        table: 'applications',
        type: 'left',
        on: 'apps.member_id = m.id AND apps.deleted_at IS NULL',
      },
      {
        alias: 'acts',
        table: 'activities',
        type: 'left',
        on: 'acts.member_id = m.id AND acts.deleted_at IS NULL',
      },
    ],
    allowedColumns: [
      ...MEMBER_COLUMNS('m'),
      ...USER_COLUMNS('owner'),
      ...REGULAR_CONTACT_COLUMNS('rc'),
      { source: 'apps.id', label: '申込件数', dataType: 'text', aggregatable: true },
      {
        source: 'apps.payment_amount',
        label: '総入金額(申込)',
        dataType: 'number',
        aggregatable: true,
      },
      {
        source: 'acts.id',
        label: '対応件数',
        dataType: 'number',
        aggregatable: true,
      },
      {
        source: 'acts.registered_datetime',
        label: '最終対応日',
        dataType: 'datetime',
        aggregatable: true,
      },
    ],
  },

  // RT03: 会員と申込 — 1申込=1行
  RT03: {
    reportType: 'RT03',
    baseTable: 'applications',
    baseAlias: 'a',
    baseWhere: ['a.deleted_at IS NULL'],
    allowedJoins: [JOIN_APP_TO_MEMBER, JOIN_APP_TO_PROJECT, JOIN_APP_TO_OWNER, JOIN_MEMBER_TO_REGULAR_CONTACT],
    allowedColumns: [
      ...APP_COLUMNS('a'),
      ...MEMBER_COLUMNS('m'),
      ...PROJECT_COLUMNS('p'),
      ...USER_COLUMNS('owner'),
      ...REGULAR_CONTACT_COLUMNS('rc'),
    ],
  },

  // RT04: 会員と対応歴 — 1対応=1行
  RT04: {
    reportType: 'RT04',
    baseTable: 'activities',
    baseAlias: 'act',
    baseWhere: ['act.deleted_at IS NULL'],
    allowedJoins: [JOIN_ACT_TO_MEMBER, JOIN_ACT_TO_OWNER, JOIN_MEMBER_TO_REGULAR_CONTACT],
    allowedColumns: [
      ...ACTIVITY_COLUMNS('act'),
      ...MEMBER_COLUMNS('m'),
      ...USER_COLUMNS('owner'),
      ...REGULAR_CONTACT_COLUMNS('rc'),
    ],
  },

  // RT05: 会員と問合せ — 1問合せ=1行
  RT05: {
    reportType: 'RT05',
    baseTable: 'inquiries',
    baseAlias: 'inq',
    baseWhere: ['inq.deleted_at IS NULL'],
    allowedJoins: [JOIN_INQ_TO_FORM, JOIN_INQ_TO_MEMBER, JOIN_MEMBER_TO_REGULAR_CONTACT],
    allowedColumns: [
      ...INQUIRY_COLUMNS('inq'),
      ...FORM_COLUMNS('f'),
      ...MEMBER_COLUMNS('m'),
      ...REGULAR_CONTACT_COLUMNS('rc'),
    ],
  },

  // RT06: 申込一覧 — 1申込=1行
  RT06: {
    reportType: 'RT06',
    baseTable: 'applications',
    baseAlias: 'a',
    baseWhere: ['a.deleted_at IS NULL'],
    allowedJoins: [JOIN_APP_TO_MEMBER, JOIN_APP_TO_PROJECT, JOIN_APP_TO_OWNER, JOIN_MEMBER_TO_REGULAR_CONTACT],
    allowedColumns: [
      ...APP_COLUMNS('a'),
      ...MEMBER_COLUMNS('m'),
      ...PROJECT_COLUMNS('p'),
      ...USER_COLUMNS('owner'),
      ...REGULAR_CONTACT_COLUMNS('rc'),
    ],
  },

  // RT07: 対応歴一覧 — 1対応=1行
  RT07: {
    reportType: 'RT07',
    baseTable: 'activities',
    baseAlias: 'act',
    baseWhere: ['act.deleted_at IS NULL'],
    allowedJoins: [JOIN_ACT_TO_OWNER, JOIN_ACT_TO_MEMBER, JOIN_MEMBER_TO_REGULAR_CONTACT],
    allowedColumns: [
      ...ACTIVITY_COLUMNS('act'),
      ...USER_COLUMNS('owner'),
      ...MEMBER_COLUMNS('m'),
      ...REGULAR_CONTACT_COLUMNS('rc'),
    ],
  },

  // RT08: 対応歴マトリクス — クロス集計(担当×期間×分類)
  RT08: {
    reportType: 'RT08',
    baseTable: 'activities',
    baseAlias: 'act',
    baseWhere: ['act.deleted_at IS NULL'],
    allowedJoins: [JOIN_ACT_TO_OWNER, JOIN_ACT_TO_MEMBER],
    allowedColumns: [
      ...ACTIVITY_COLUMNS('act'),
      ...USER_COLUMNS('owner'),
    ],
  },

  // RT09: 問合せ一覧
  RT09: {
    reportType: 'RT09',
    baseTable: 'inquiries',
    baseAlias: 'inq',
    baseWhere: ['inq.deleted_at IS NULL'],
    allowedJoins: [JOIN_INQ_TO_FORM, JOIN_INQ_TO_MEMBER, JOIN_MEMBER_TO_REGULAR_CONTACT],
    allowedColumns: [
      ...INQUIRY_COLUMNS('inq'),
      ...FORM_COLUMNS('f'),
      ...MEMBER_COLUMNS('m'),
      ...REGULAR_CONTACT_COLUMNS('rc'),
    ],
  },

  // RT10: 案件別実績 — 1案件=1行(集計済)
  RT10: {
    reportType: 'RT10',
    baseTable: 'applications',
    baseAlias: 'a',
    baseWhere: ['a.deleted_at IS NULL'],
    allowedJoins: [JOIN_APP_TO_PROJECT],
    allowedColumns: [
      { source: 'p.id', label: '案件ID', dataType: 'number', groupable: true },
      { source: 'p.name', label: '案件名', dataType: 'text', groupable: true, sortable: true },
      // 2026-05: p.category カラム廃止により削除
      { source: 'a.id', label: '申込件数', dataType: 'text', aggregatable: true },
      { source: 'a.payment_amount', label: '合計入金額', dataType: 'number', aggregatable: true },
      { source: 'a.status', label: 'ステータス', dataType: 'enum', filterable: true, groupable: true },
    ],
  },
};

/**
 * カラムソース文字列(例: 'm.name')から AllowedColumnDef を引く。
 * SQL Builder で「ホワイトリストにあるか」のチェックに使用。
 */
export function findColumn(
  reportType: ReportTypeId,
  source: string,
): AllowedColumnDef | undefined {
  const def = REPORT_SCHEMAS[reportType];
  if (!def) return undefined;
  return def.allowedColumns.find((c) => c.source === source);
}

/**
 * source 文字列が安全な識別子のみで構成されているかを検証。
 * SQL インジェクション防止のための最終ガード。
 *
 * 受け入れる形式:
 *   - 'alias' / 'alias.column' (通常カラム)
 *   - 'alias.extra:key_name' (extra jsonb キー。key_name は英数+_+- まで)
 */
export function isSafeIdentifier(source: string): boolean {
  // 通常: alias.column 形式
  if (/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/.test(source)) {
    return true;
  }
  // extra キー形式: alias.extra:key
  // alias と "extra" は識別子相当、key は日本語含む可能性があるので限定的に許可。
  // 安全のため key は \w (英数+_) と日本語ひらがな・カタカナ・漢字、半角ハイフン、括弧、半角空白、
  // 全角空白までに限定。シングルクォート・バックスラッシュ・セミコロン等は明示的に拒否する。
  const extraMatch = source.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.extra:(.+)$/);
  if (extraMatch) {
    const key = extraMatch[2]!;
    // 危険文字を含まないこと: ' " ` \ ; -- /* */ (
    if (/['"`\\;]|--|\/\*|\*\//.test(key)) return false;
    // 1文字以上、200文字以下
    if (key.length === 0 || key.length > 200) return false;
    return true;
  }
  return false;
}

/**
 * extra キーの source 文字列を SQL 片に展開する。
 * 例: 'm.extra:investing_amount' → "m.extra->>'investing_amount'"
 *
 * 呼び出し前に isSafeIdentifier() で検証済みである前提。
 * シングルクォートのエスケープは念のため2重で行う(防御的)。
 */
export function expandExtraSource(source: string): string {
  const m = source.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\.extra:(.+)$/);
  if (!m) return source; // 通常カラムはそのまま返す
  const alias = m[1]!;
  const key = m[2]!.replace(/'/g, "''");
  return `${alias}.extra->>'${key}'`;
}

/**
 * レポートタイプごとの主軸オブジェクト(object_definitions.id と一致)。
 * field_definitions の extra カラムロードに使う。
 */
export const REPORT_BASE_OBJECT: Record<ReportTypeId, string> = {
  RT01: 'members',
  RT02: 'members',
  RT03: 'applications',
  RT04: 'activities',
  RT05: 'inquiries',
  RT06: 'applications',
  RT07: 'activities',
  RT08: 'activities',
  RT09: 'inquiries',
  RT10: 'applications',
};

/**
 * レポートタイプ→主軸エイリアス。
 * extra キーの SQL 展開時に "{baseAlias}.extra->>'key'" を組み立てるために使う。
 */
export function getBaseAlias(reportType: ReportTypeId): string {
  return REPORT_SCHEMAS[reportType].baseAlias;
}
