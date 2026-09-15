/**
 * 取込ルールの「入れる項目」の選択肢(CLAUDE.md §5.16)。純粋関数。
 *
 * 選択肢は フォーム(form_id) / 問合せの項目(DB 列のホワイトリスト) / 可変項目(項目管理で定義済み) /
 * 可変項目(新規)。問合せの可変項目は 289 件あるため、画面では文字で絞り込めるセレクトにする。
 * 絞り込みの規則(表示名の部分一致。大文字小文字・全角半角の違いは無視)はここで固定し、
 * 画面部品(app/(mailer)/mail/ImportRuleTargetSelect.tsx)はこれを使うだけにする。
 */

import { FIELD_COLUMNS, FIELD_COLUMN_LABELS, type FieldColumn } from './mail_import_rules';

/** 問合せの項目定義(field_definitions)のうち、割り当て先の選択肢に使う部分 */
export interface InquiryFieldOption {
  field_name: string;
  label: string | null;
  is_in_db: boolean;
}

/**
 * 割り当て先「フォーム」の値。field_map には保存せず、選ぶと「フォーム名の取り方」を
 * 「本文のラベルの値」(body_label)+そのラベルに切り替える(問合せの form_id に入る)。
 */
export const FORM_TARGET = 'form';

export interface TargetOption {
  value: string;
  label: string;
}

export interface TargetOptions {
  /** 問合せの「フォーム」(form_id)の表示名 */
  formLabel: string;
  columns: Array<{ value: FieldColumn; label: string }>;
  extras: TargetOption[];
  extraKeys: Set<string>;
}

/** 割り当て先の選択肢: フォーム、DB 列(ホワイトリスト内。表示名は項目管理のラベル優先)、定義済みの可変項目 */
export function buildTargetOptions(inquiryFields: InquiryFieldOption[]): TargetOptions {
  const labelByColumn = new Map<string, string>();
  for (const f of inquiryFields) {
    if (f.is_in_db && f.label) labelByColumn.set(f.field_name, f.label);
  }
  const columns = FIELD_COLUMNS.map((c) => ({
    value: c,
    label: labelByColumn.get(c) ?? FIELD_COLUMN_LABELS[c],
  }));
  const extras = inquiryFields
    .filter((f) => !f.is_in_db)
    .map((f) => ({ value: `extra:${f.field_name}`, label: f.label ?? f.field_name }));
  return {
    formLabel: labelByColumn.get('form_id') ?? 'フォーム',
    columns,
    extras,
    extraKeys: new Set(extras.map((e) => e.value)),
  };
}

/** 割り当て先(value)の表示名。未定義の可変項目は「<キー>(新規)」 */
export function targetLabel(options: TargetOptions, target: string): string {
  if (target === FORM_TARGET) return options.formLabel;
  const col = options.columns.find((c) => c.value === target);
  if (col) return col.label;
  const ex = options.extras.find((e) => e.value === target);
  if (ex) return ex.label;
  return target.startsWith('extra:') ? `${target.slice('extra:'.length)}(新規)` : target;
}

/** 検索用の正規化: 全角半角を揃え(NFKC)、小文字にし、空白を除く */
function normalizeQuery(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

export interface FilteredTargetOptions {
  form: TargetOption | null;
  columns: TargetOption[];
  extras: TargetOption[];
  /** 本文のラベルを新しい可変項目として追加する選択肢(同名が定義済みなら null) */
  newExtra: TargetOption | null;
}

/**
 * 検索語で選択肢を絞る。空なら全件。表示名の部分一致(大文字小文字・全角半角の違いは無視)。
 * `label` は本文のラベル(「可変項目(新規)」の候補名)。
 */
export function filterTargetOptions(
  options: TargetOptions,
  query: string,
  label: string,
): FilteredTargetOptions {
  const q = normalizeQuery(query);
  const hit = (text: string) => q === '' || normalizeQuery(text).includes(q);
  const newExtraValue = `extra:${label}`;
  const newExtra =
    label.trim() !== '' && !options.extraKeys.has(newExtraValue) && hit(label)
      ? { value: newExtraValue, label }
      : null;
  return {
    form: hit(options.formLabel) ? { value: FORM_TARGET, label: options.formLabel } : null,
    columns: options.columns.filter((c) => hit(c.label)),
    extras: options.extras.filter((e) => hit(e.label)),
    newExtra,
  };
}
