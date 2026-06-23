/**
 * CSV 取込スキーマ (突発アップロード #2 / 将来の Drive 連携 #1 共通)
 *
 * オブジェクトごとに「取込可能な項目」をホワイトリストで固定する(安全のため)。
 *   - CSV のヘッダー名 = label
 *   - upsert は idField で突合(無ければ新規作成)
 *   - 値の型変換は coerce.ts が type を見て行う
 *
 * members / applications / inquiries / projects に加え、対応歴(activities)も対応。
 * 対応歴はID列が無いことが多いため、専用ハンドラ(import_activities)が行内容のハッシュで
 * legacy_sf_id を生成して突合する(同一内容は重複しない)。ここの fields はテンプレ生成用。
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
  /** 値が空(null)のときに使う既定値(NOT NULL カラム向け) */
  default?: string | number | boolean;
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
  // 会員は専用ハンドラ(lib/domain/import_members.ts)で取込む。
  // ここの fields はテンプレCSVのヘッダー生成にのみ使用(実CSVの日本語ヘッダーに一致)。
  members: {
    object: 'members',
    table: 'members',
    label: '会員',
    idField: 'id',
    note: '元の会員CSVをそのまま使えます。会員ID(K-)で突合。電話番号末尾の「架電NG」は自動分離、永久担当は担当者名で解決します。',
    fields: [
      { field: 'id', label: '会員ID', type: 'text', required: true },
      { field: 'name', label: '会員氏名', type: 'text', required: true },
      { field: 'name_kana', label: '会員かな', type: 'text' },
      { field: 'owner_name_raw', label: '永久担当', type: 'text' },
      { field: 'email1', label: 'Eメール1', type: 'text' },
      { field: 'phone1', label: '電話番号1', type: 'text' },
      { field: 'address', label: '住所(フル)', type: 'text' },
      { field: 'customer_type', label: '顧客種別', type: 'text' },
      { field: 'gender', label: '性別', type: 'text' },
      { field: 'birthdate', label: '生年月日', type: 'date' },
      { field: 'first_contact_date', label: '初回接触日', type: 'date' },
      { field: 'registered_at', label: '登録日', type: 'datetime' },
      { field: 'total_amount', label: '総合計額', type: 'number' },
      { field: 'total_paid_amount', label: '総合計実入金額', type: 'number' },
      { field: 'total_used_amount', label: '総利用額合計', type: 'number' },
    ],
  },

  // 申込は専用ハンドラ(lib/domain/import_applications.ts)で取込む。
  // fields はテンプレCSVのヘッダー生成にのみ使用(実CSVの日本語ヘッダーに一致)。
  applications: {
    object: 'applications',
    table: 'applications',
    label: '申込',
    idField: 'id',
    note: '元の申込CSVをそのまま使えます。申込情報ID(M-)で突合。投資案件は案件名で解決、会員ID/問合せ管理IDは既存のもの、永久担当/申込獲得者は担当者名で解決します。案件固有列は extra に格納。',
    fields: [
      { field: 'id', label: '申込情報ID', type: 'text', required: true },
      { field: 'project_id', label: '投資案件', type: 'text' },
      { field: 'member_id', label: '会員ID', type: 'text' },
      { field: 'inquiry_id', label: '問合せ管理ID', type: 'text' },
      { field: 'application_date', label: '申込日', type: 'date' },
      { field: 'status', label: 'ステータス', type: 'text' },
      { field: 'flow_type', label: '入金/移動', type: 'text' },
      { field: 'owner_name_raw', label: '永久担当', type: 'text' },
      { field: 'acquirer_name_raw', label: '申込獲得者', type: 'text' },
      { field: 'payment_date', label: '入金日', type: 'date' },
      { field: 'payment_amount', label: '入金額', type: 'number' },
      { field: 'withdrawal_amount', label: '出金額', type: 'number' },
      { field: 'withdrawal_date', label: '出金日', type: 'date' },
      { field: 'start_month', label: '起算月', type: 'text' },
      { field: 'contract_period', label: '契約期間', type: 'text' },
    ],
  },

  // 問合せは専用ハンドラ(lib/domain/import_inquiries.ts)で取込む。
  // ここの fields はテンプレCSVのヘッダー(共通列)生成にのみ使用。
  // フォーム名→form_id 解決、共通列以外→extra(JSONB) はハンドラ側で処理する。
  inquiries: {
    object: 'inquiries',
    table: 'inquiries',
    label: '問合せ',
    idField: 'id',
    note: '元のフォーム出力CSVをそのまま使えます。問合せID(TA-)で突合。「フォーム名」はforms名で解決(無ければ新規追加)、共通列以外はextraに格納されます。2フォーム分は定期取込(Drive)で2ファイル指定可。',
    fields: [
      { field: 'id', label: '問合せID', type: 'text', required: true },
      { field: 'member_id', label: '会員ID', type: 'text' },
      { field: 'form_name', label: 'フォーム名', type: 'text' },
      { field: 'name', label: '氏名', type: 'text' },
      { field: 'name_kana', label: '氏名かな', type: 'text' },
      { field: 'email', label: 'メールアドレス', type: 'text' },
      { field: 'phone', label: '電話番号', type: 'text' },
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
      { field: 'name', label: '案件', type: 'text', required: true },
      { field: 'description', label: '説明', type: 'text' },
      { field: 'is_active', label: '有効', type: 'boolean', default: true },
    ],
  },

  // 対応歴(activities)は専用ハンドラ(lib/domain/import_activities.ts)で取込む。
  // ID列が無いため行内容のハッシュで突合(同一内容は重複しない)。任意で「対応歴ID」列があれば優先。
  // ここの fields はテンプレCSVのヘッダー生成にのみ使用。
  activities: {
    object: 'activities',
    table: 'activities',
    label: '対応歴',
    idField: 'legacy_sf_id',
    note: '会員ID(K-)で会員に紐付け、担当は担当者名で解決します。ID列が無くても取込可能で、同一内容の行は重複しません(再取込しても増えません)。「対応歴ID」列があればそれで突合します。',
    fields: [
      { field: 'legacy_sf_id', label: '対応歴ID', type: 'text' },
      { field: 'member_id', label: '会員ID', type: 'text' },
      { field: 'owner_name', label: '担当', type: 'text' },
      { field: 'd_bunrui', label: '大分類', type: 'text' },
      { field: 'm_bunrui', label: '中分類', type: 'text' },
      { field: 's_bunrui', label: '小分類', type: 'text' },
      { field: 'registered_datetime', label: '登録日時', type: 'datetime' },
      { field: 'description', label: '対応詳細', type: 'text' },
    ],
  },
};

export const IMPORT_OBJECT_KEYS = Object.keys(IMPORT_OBJECTS);

/**
 * 定期取込(Drive 連携 #1)の対象キー。
 * 対応歴(activities)は定期取込の対象外(突発アップロードのみ)。
 */
export const ROUTINE_OBJECT_KEYS = IMPORT_OBJECT_KEYS.filter((k) => k !== 'activities');
