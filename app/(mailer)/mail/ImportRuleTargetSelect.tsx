'use client';

import {
  FIELD_COLUMNS,
  FIELD_COLUMN_LABELS,
  type FieldColumn,
} from '@/lib/domain/mail_import_rules';

/**
 * 取込ルールの「入れる項目」セレクト(CLAUDE.md §5.16)。
 * 取込候補のメール詳細の「取込ルール」パネルと、/mail/settings の編集ダイアログの両方で使う。
 * 選択肢は 問合せの項目(DB 列のホワイトリスト) / 可変項目(項目管理で定義済み) / 可変項目(新規)。
 */

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

export interface TargetOptions {
  /** 問合せの「フォーム」(form_id)の表示名 */
  formLabel: string;
  columns: Array<{ value: FieldColumn; label: string }>;
  extras: Array<{ value: string; label: string }>;
  extraKeys: Set<string>;
}

/** 割り当て先の選択肢: DB 列(ホワイトリスト内)と、定義済みの可変項目 */
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

/** 割り当て先(value)の表示名 */
export function targetLabel(options: TargetOptions, target: string): string {
  if (target === FORM_TARGET) return options.formLabel;
  const col = options.columns.find((c) => c.value === target);
  if (col) return col.label;
  const ex = options.extras.find((e) => e.value === target);
  if (ex) return ex.label;
  return target.startsWith('extra:') ? `${target.slice('extra:'.length)}(新規)` : target;
}

export const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

interface Props {
  /** 本文のラベル(「可変項目(新規)」の候補名になる) */
  label: string;
  value: string;
  onChange: (target: string) => void;
  options: TargetOptions;
  disabled?: boolean;
}

export function ImportRuleTargetSelect({ label, value, onChange, options, disabled }: Props) {
  const newExtra = `extra:${label}`;
  // 定義済みの可変項目に同名が無いときだけ「新規」を出す。既存ルールが未定義キーを指している場合も選べるようにする
  const showNewExtra = !options.extraKeys.has(newExtra);
  const unknownCurrent =
    value !== '' &&
    value !== FORM_TARGET &&
    value !== newExtra &&
    !options.columns.some((c) => c.value === value) &&
    !options.extraKeys.has(value);
  return (
    <select
      className={selectClass}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value="">(入れない)</option>
      <optgroup label="問合せの項目">
        <option value={FORM_TARGET}>{options.formLabel}</option>
        {options.columns.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </optgroup>
      {options.extras.length > 0 && (
        <optgroup label="可変項目(定義済み)">
          {options.extras.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </optgroup>
      )}
      {(showNewExtra || unknownCurrent) && (
        <optgroup label="可変項目(新規)">
          {showNewExtra && <option value={newExtra}>「{label}」を新しい可変項目として追加</option>}
          {unknownCurrent && <option value={value}>{targetLabel(options, value)}</option>}
        </optgroup>
      )}
    </select>
  );
}
