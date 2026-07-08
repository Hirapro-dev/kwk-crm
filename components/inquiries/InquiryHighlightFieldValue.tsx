import { PhoneLink } from '@/components/layout/PhoneLink';
import type { Inquiry } from '@/lib/domain/inquiries';
import type { FieldDefinition } from '@/lib/domain/object_metadata';
import { formatDate, formatDateTime } from '@/lib/utils/date';
import { formatFieldValue, getFieldValue } from '@/lib/utils/format_field';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * 問合せ詳細のハイライトパネルでフィールド値を描画するヘルパー。
 * オブジェクト管理(レイアウトエディタ)の「ハイライト」設定に従って
 * field_definitions のフィールドを1つずつ描画する。
 * フォーム/会員ID/電話/登録日時は専用表示、それ以外は data_type で汎用表示。
 */
export function renderInquiryHighlightFieldValue(
  field: FieldDefinition,
  inquiry: Inquiry,
): ReactNode {
  const { field_name, data_type } = field;

  // フォーム: form_id → フォーム名(生IDではなく名称)
  if (field_name === 'form_id' || field_name === 'form_name') {
    return <span>{inquiry.form?.name ?? '-'}</span>;
  }

  // 会員ID: 会員詳細へのリンク(紐付いている場合)
  if (field_name === 'member_id') {
    if (!inquiry.member) return <span className="text-muted-foreground">-</span>;
    return (
      <Link href={`/members/${inquiry.member.id}`} className="text-primary hover:underline">
        {inquiry.member.id}
      </Link>
    );
  }

  // 氏名: 会員が紐付いていれば会員詳細へのリンクにする
  if (field_name === 'name') {
    const text = inquiry.name ?? '-';
    if (!inquiry.member) return <span>{text}</span>;
    return (
      <Link href={`/members/${inquiry.member.id}`} className="text-primary hover:underline">
        {text}
      </Link>
    );
  }

  // 電話番号: タップ発信リンク
  if (field_name === 'phone') {
    return <PhoneLink value={inquiry.phone} />;
  }

  // 登録日時: 日時表示
  if (field_name === 'registered_at') {
    return <span>{formatDateTime(inquiry.registered_at) || '-'}</span>;
  }

  // --- data_type によるジェネリックレンダリング(extra 列も対応) ---
  const raw = getRaw(inquiry, field);

  if (data_type === 'date' || data_type === 'datetime') {
    if (!raw) return <span className="text-muted-foreground">-</span>;
    return <span>{formatDate(String(raw))}</span>;
  }
  if (raw === null || raw === undefined || raw === '') {
    return <span className="text-muted-foreground">-</span>;
  }
  return <span>{formatFieldValue(raw, data_type, field.label ?? field_name)}</span>;
}

/**
 * inquiry から field に対応する値を取り出す。
 * DB物理カラム(is_in_db=true) / extra(CSV列名, is_in_db=false) 両対応。旧 extra.XXX も後方互換。
 */
function getRaw(inquiry: Inquiry, field: FieldDefinition): unknown {
  const record = inquiry as unknown as Record<string, unknown>;
  if (field.field_name.startsWith('extra.')) {
    const key = field.field_name.slice('extra.'.length);
    return inquiry.extra?.[key] ?? null;
  }
  return getFieldValue(record, field.field_name, field.is_in_db, field.csv_column_name) ?? null;
}
