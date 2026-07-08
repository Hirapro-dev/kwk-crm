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
    note: '会員ID(K-)で会員に紐付け、対応者は担当者名で解決します。接触種別は選択肢以外の文字列もそのまま取込可、接触内容は空欄でもOK。ID列が無くても取込可能で、同一内容の行は重複しません(再取込しても増えません)。「対応歴ID」列があればそれで突合します。',
    fields: [
      { field: 'legacy_sf_id', label: '対応歴ID', type: 'text' },
      { field: 'member_id', label: '会員ID', type: 'text' },
      { field: 'owner_name', label: '対応者', type: 'text' },
      { field: 'd_bunrui', label: '接触種別', type: 'text' },
      { field: 'm_bunrui', label: '接触内容', type: 'text' },
      { field: 's_bunrui', label: '状態', type: 'text' },
      { field: 'registered_datetime', label: '登録日時', type: 'datetime' },
      { field: 'description', label: '対応詳細', type: 'text' },
    ],
  },

  // 記事反応リスト(article_reactions)は専用ハンドラ(lib/domain/import_article_reactions.ts)で取込む。
  // 反応ID(KH…)で突合。会員ID(K-)は既存会員にあれば紐付け、無ければ member_id は null。
  // ここの fields はテンプレCSVのヘッダー生成にのみ使用(実CSVの日本語ヘッダーに一致)。
  article_reactions: {
    object: 'article_reactions',
    table: 'article_reactions',
    label: '記事反応リスト',
    idField: 'id',
    note: '元の記事反応CSVをそのまま使えます。反応ID(KH…)で突合。会員ID(K-)で会員に紐付け(未登録会員はnull)、「会員氏名」列の旧SalesforceID/「会員氏名（漢字）」の氏名はそのまま保持します。',
    fields: [
      { field: 'id', label: 'ID', type: 'text', required: true },
      { field: 'reacted_date', label: '日付', type: 'date' },
      { field: 'media', label: '配信媒体', type: 'text' },
      { field: 'tool', label: '配信ツール', type: 'text' },
      { field: 'reaction_type', label: '種類', type: 'text' },
      { field: 'form_name', label: 'フォーム名', type: 'text' },
      { field: 'member_name', label: '会員氏名（漢字）', type: 'text' },
      { field: 'member_legacy_sf_id', label: '会員氏名', type: 'text' },
      { field: 'member_id', label: '会員ID', type: 'text' },
      { field: 'detail', label: '詳細', type: 'text' },
    ],
  },

  // 出金管理-親/子は専用ハンドラ(lib/domain/import_withdrawals.ts)で取込む。
  // ID(SO-/SC-)で突合。会員ID(K-)・償還-親No は実在チェックして紐付け(無ければ null)。
  // ここの fields はテンプレCSVのヘッダー生成にのみ使用(実CSVの日本語ヘッダーに一致)。
  // ※ 定期取込の「まとめて取り込み」は定義順に実行されるため、親を子より先に置くこと。
  withdrawal_parents: {
    object: 'withdrawal_parents',
    table: 'withdrawal_parents',
    label: '出金管理-親',
    idField: 'id',
    note: '元の【親】取込用CSVをそのまま使えます。償還-親No(SO-)で突合。会員ID(K-)で会員に紐付け(未登録会員はnull)。上記以外の列(出金管理【親】/SFID等)は取り込みません。',
    fields: [
      { field: 'id', label: '償還-親No', type: 'text', required: true },
      { field: 'member_id', label: '会員ID', type: 'text' },
      { field: 'member_name', label: '会員氏名', type: 'text' },
      { field: 'project_name', label: '投資案件', type: 'text' },
      { field: 'campaign', label: 'ｷｬﾝﾍﾟｰﾝ名', type: 'text' },
      { field: 'principal', label: '元金', type: 'number' },
      { field: 'profit', label: '利益', type: 'number' },
      { field: 'total_amount', label: '元利合計', type: 'number' },
    ],
  },

  withdrawal_children: {
    object: 'withdrawal_children',
    table: 'withdrawal_children',
    label: '出金管理-子',
    idField: 'id',
    note: '元の【子】取込用CSVをそのまま使えます。償還-子No(SC-)で突合。償還-親No(SO-)で親に、会員ID(K-)で会員に紐付け(未登録はnull・原文は保持)。親を先に取り込んでください。上記以外の列(出金管理【子】/セールスフォースＩＤ/償還管理ID等)は取り込みません。',
    fields: [
      { field: 'id', label: '償還-子No', type: 'text', required: true },
      { field: 'parent_no', label: '償還-親No', type: 'text' },
      { field: 'member_id', label: '会員ID', type: 'text' },
      { field: 'member_name', label: '会員氏名', type: 'text' },
      { field: 'project_name', label: '投資案件', type: 'text' },
      { field: 'campaign', label: 'ｷｬﾝﾍﾟｰﾝ名', type: 'text' },
      { field: 'withdrawal_date', label: '出金日', type: 'date' },
      { field: 'amount', label: '出金額', type: 'number' },
    ],
  },

  // 従業員(users)は専用ハンドラ(lib/domain/import_users.ts)で取込む。
  // email で突合(legacy_sf_id があれば優先)、新規は UUID 採番。ここの fields はテンプレ生成用。
  users: {
    object: 'users',
    table: 'users',
    label: '従業員',
    idField: 'id',
    note: 'メール(必須)で突合します。「ユーザーID」(旧Salesforce ID)があれば優先。権限は admin/manager/sales/viewer(営業/役員/管理 等の表記も可、不明は viewer)。CSV取込ユーザーはログイン不可(担当者として利用)。',
    fields: [
      { field: 'legacy_sf_id', label: 'ユーザーID', type: 'text' },
      { field: 'email', label: 'メール', type: 'text', required: true },
      { field: 'last_name', label: '姓', type: 'text' },
      { field: 'first_name', label: '名', type: 'text' },
      { field: 'full_name', label: '氏名', type: 'text' },
      { field: 'role', label: '権限', type: 'text' },
      { field: 'is_active', label: '有効', type: 'boolean', default: true },
    ],
  },
};

export const IMPORT_OBJECT_KEYS = Object.keys(IMPORT_OBJECTS);

/**
 * 定期取込(Drive 連携 #1)の対象キー。
 * 対応歴(activities)・従業員(users)は定期取込の対象外(突発アップロードのみ)。
 */
const ROUTINE_EXCLUDED = new Set(['activities', 'users']);
export const ROUTINE_OBJECT_KEYS = IMPORT_OBJECT_KEYS.filter((k) => !ROUTINE_EXCLUDED.has(k));
