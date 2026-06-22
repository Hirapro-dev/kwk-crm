/**
 * CSV 取込スキーマ (突発アップロード #2 / 将来の Drive 連携 #1 共通)
 *
 * オブジェクトごとに「取込可能な項目」をホワイトリストで固定する(安全のため)。
 *   - CSV のヘッダー名 = label
 *   - upsert は idField で突合(無ければ新規作成)
 *   - 値の型変換は coerce.ts が type を見て行う
 *
 * activities(120万件級)は対象外。members / applications / inquiries / projects のみ。
 */

export type ImportFieldType = 'text' | 'number' | 'date' | 'datetime' | 'boolean';

export interface ImportField {
  /** DB カラム名 */
  field: string;
  /** CSV ヘッダー(表示名) */
  label: string;
  type: ImportFieldType;
  /** 必須(空ならエラー)。主キーは必須。 */
  required?: boolean;
}

export interface ImportObjectDef {
  /** object_definitions.id 相当 */
  object: string;
  /** 物理テーブル名 */
  table: string;
  /** 表示名 */
  label: string;
  /** 突合に使う主キーのカラム名 */
  idField: string;
  /** 取込可能項目(先頭は必ず主キー) */
  fields: ImportField[];
  /** テンプレに添える補足 */
  note?: string;
}

export const IMPORT_OBJECTS: Record<string, ImportObjectDef> = {
  members: {
    object: 'members',
    table: 'members',
    label: '会員',
    idField: 'id',
    note: '会員ID(K-XXXXXXX)で突合します。空なら取込不可。',
    fields: [
      { field: 'id', label: '会員ID', type: 'text', required: true },
      { field: 'name', label: '氏名', type: 'text' },
      { field: 'name_kana', label: '氏名カナ', type: 'text' },
      { field: 'real_name', label: '実質名義人', type: 'text' },
      { field: 'email1', label: 'メール1', type: 'text' },
      { field: 'email2', label: 'メール2', type: 'text' },
      { field: 'email3', label: 'メール3', type: 'text' },
      { field: 'phone1', label: '電話', type: 'text' },
      { field: 'do_not_call', label: '架電NG', type: 'boolean' },
      { field: 'postal_code', label: '郵便番号', type: 'text' },
      { field: 'address', label: '住所', type: 'text' },
      { field: 'customer_type', label: '顧客種別', type: 'text' },
      { field: 'gender', label: '性別', type: 'text' },
      { field: 'birthdate', label: '生年月日', type: 'date' },
      { field: 'first_contact_date', label: '初回接触日', type: 'date' },
      { field: 'registered_at', label: '登録日時', type: 'datetime' },
      { field: 'total_amount', label: '総取引額', type: 'number' },
      { field: 'total_paid_amount', label: '総入金額', type: 'number' },
      { field: 'total_used_amount', label: '総利用額', type: 'number' },
    ],
  },

  applications: {
    object: 'applications',
    table: 'applications',
    label: '申込',
    idField: 'id',
    note: '申込ID(M-XXXXXXX)で突合します。会員ID・案件IDは既存のものを指定してください。',
    fields: [
      { field: 'id', label: '申込ID', type: 'text', required: true },
      { field: 'member_id', label: '会員ID', type: 'text' },
      { field: 'project_id', label: '案件ID', type: 'text' },
      { field: 'application_date', label: '申込日', type: 'date' },
      { field: 'status', label: 'ステータス', type: 'text' },
      { field: 'flow_type', label: '入出金区分', type: 'text' },
      { field: 'payment_amount', label: '入金額', type: 'number' },
      { field: 'payment_date', label: '入金日', type: 'date' },
      { field: 'scheduled_payment_date', label: '入金予定日', type: 'date' },
      { field: 'scheduled_amount', label: '入金予定額', type: 'number' },
      { field: 'withdrawal_amount', label: '出金額', type: 'number' },
      { field: 'withdrawal_date', label: '出金日', type: 'date' },
      { field: 'start_month', label: '起算月', type: 'text' },
      { field: 'contract_period', label: '契約期間', type: 'text' },
    ],
  },

  inquiries: {
    object: 'inquiries',
    table: 'inquiries',
    label: '問合せ',
    idField: 'id',
    note: '問合せID(TA-XXXXXXX)で突合します。',
    fields: [
      { field: 'id', label: '問合せID', type: 'text', required: true },
      { field: 'form_id', label: 'フォームID', type: 'number' },
      { field: 'member_id', label: '会員ID', type: 'text' },
      { field: 'name', label: '氏名', type: 'text' },
      { field: 'name_kana', label: '氏名カナ', type: 'text' },
      { field: 'email', label: 'メール', type: 'text' },
      { field: 'phone', label: '電話', type: 'text' },
      { field: 'postal_code', label: '郵便番号', type: 'text' },
      { field: 'address', label: '住所', type: 'text' },
      { field: 'ad_id', label: '広告ID', type: 'text' },
      { field: 'registered_at', label: '登録日時', type: 'datetime' },
    ],
  },

  projects: {
    object: 'projects',
    table: 'projects',
    label: '案件',
    idField: 'id',
    note: '案件IDで突合します。新規案件は新しいIDを指定してください。',
    fields: [
      { field: 'id', label: '案件ID', type: 'text', required: true },
      { field: 'name', label: '案件名', type: 'text', required: true },
      { field: 'description', label: '説明', type: 'text' },
      { field: 'is_active', label: '有効', type: 'boolean' },
    ],
  },
};

export const IMPORT_OBJECT_KEYS = Object.keys(IMPORT_OBJECTS);
