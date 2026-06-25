import { PhoneLink } from '@/components/layout/PhoneLink';
import { Badge } from '@/components/ui/badge';
import type { FieldDefinition } from '@/lib/domain/object_metadata';
import type { MemberWithOwner } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils/date';
import { formatFieldValue, getFieldValue } from '@/lib/utils/format_field';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * ハイライトパネルでフィールド値を描画するヘルパー。
 * field_definitions の field_name と data_type に応じて適切なコンポーネントを返す。
 */
export function renderHighlightFieldValue(
  field: FieldDefinition,
  member: MemberWithOwner,
): ReactNode {
  const { field_name, data_type } = field;

  // --- 特定フィールドの専用レンダリング ---

  // プロテクト: protect_by_user_id → ユーザー名 + 期限
  if (field_name === 'protect_by_user_id') {
    if (!member.protect_by_user_id) {
      return <span className="text-muted-foreground">free</span>;
    }
    const name = member.protect_by_user?.full_name ?? 'free';
    const expiry = member.protect_expires_at
      ? member.protect_expires_at >= '2099-01-01'
        ? '(固定)'
        : `〜${formatDate(member.protect_expires_at)}`
      : '';
    return (
      <span>
        {name}
        {expiry && <span className="ml-1.5 text-xs text-muted-foreground">{expiry}</span>}
      </span>
    );
  }

  // 永久担当: owner_name_raw のみ表示
  if (field_name === 'owner_name_raw' || field_name === 'owner_id') {
    const label = member.owner
      ? (member.owner.full_name ?? member.owner.email)
      : (member.owner_name_raw ?? 'Free');
    return <span>{label}</span>;
  }

  // 定期連絡者: ユーザー名 + リンク
  if (field_name === 'regular_contact_id') {
    if (!member.regular_contact) return <span className="text-muted-foreground">-</span>;
    return (
      <Link href="/admin/users" className="text-primary hover:underline">
        {member.regular_contact.full_name ?? member.regular_contact.email}
      </Link>
    );
  }

  // 電話番号
  if (field_name === 'phone1') {
    return <PhoneLink value={member.phone1} />;
  }

  // --- data_type によるジェネリックレンダリング ---

  // DB物理カラム / extra(CSV列名) いずれも getFieldValue で取得する
  const raw = getRaw(member, field);

  // boolean: あり / なし バッジ
  if (data_type === 'boolean') {
    const on = raw === true || raw === 'true' || raw === '1';
    return on ? (
      <Badge variant="destructive">あり</Badge>
    ) : (
      <span className="text-muted-foreground">なし</span>
    );
  }

  // date / datetime
  if (data_type === 'date' || data_type === 'datetime') {
    if (!raw) return <span className="text-muted-foreground">-</span>;
    return <span>{formatDate(String(raw))}</span>;
  }

  // text / number / enum / その他 (number はカンマ整形)
  if (raw === null || raw === undefined || raw === '') {
    return <span className="text-muted-foreground">-</span>;
  }
  return <span>{formatFieldValue(raw, data_type, field.label ?? field_name)}</span>;
}

/**
 * member から field に対応する値を取り出す。
 * DB物理カラム(is_in_db=true) / extra(CSV列名, is_in_db=false) 両対応。
 * 旧 extra.XXX 形式も後方互換で解決する。
 */
function getRaw(member: MemberWithOwner, field: FieldDefinition): unknown {
  const record = member as unknown as Record<string, unknown>;
  // 旧 extra.XXX 形式 (後方互換)
  if (field.field_name.startsWith('extra.')) {
    const key = field.field_name.slice('extra.'.length);
    return member.extra?.[key] ?? null;
  }
  return getFieldValue(record, field.field_name, field.is_in_db, field.csv_column_name) ?? null;
}
