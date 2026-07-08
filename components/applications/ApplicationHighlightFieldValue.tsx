import { Badge } from '@/components/ui/badge';
import type { Application } from '@/lib/domain/applications';
import type { FieldDefinition } from '@/lib/domain/object_metadata';
import { formatDate } from '@/lib/utils/date';
import { formatFieldValue, getFieldValue } from '@/lib/utils/format_field';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * 申込詳細のハイライトパネルでフィールド値を描画するヘルパー。
 * オブジェクト管理(レイアウトエディタ)の「ハイライト」設定に従って描画する。
 * 案件/会員ID/問合せID/担当/獲得者/ステータス/入金区分は専用表示、
 * それ以外は data_type で汎用表示(extra 列も対応)。
 */
export function renderApplicationHighlightFieldValue(
  field: FieldDefinition,
  app: Application,
): ReactNode {
  const { field_name, data_type } = field;

  // 案件: project_id → 案件名
  if (field_name === 'project_id') {
    return <span>{app.project?.name ?? '-'}</span>;
  }

  // 会員: 会員氏名を表示して会員詳細へリンク(基本情報の表示に合わせる)
  if (field_name === 'member_id') {
    if (!app.member) return <span className="text-muted-foreground">-</span>;
    return (
      <Link href={`/members/${app.member.id}`} className="text-primary hover:underline">
        {app.member.name ?? app.member.id}
      </Link>
    );
  }

  // 問合せ管理ID: 問合せ詳細へのリンク
  if (field_name === 'inquiry_id') {
    if (!app.inquiry_id) return <span className="text-muted-foreground">-</span>;
    return (
      <Link href={`/inquiries/${app.inquiry_id}`} className="text-primary hover:underline">
        {app.inquiry_id}
      </Link>
    );
  }

  // 永久担当 / 申込獲得者: users 解決名 or 原文
  if (field_name === 'owner_id' || field_name === 'owner_name_raw') {
    return <span>{app.owner?.full_name ?? app.owner_name_raw ?? '-'}</span>;
  }
  if (field_name === 'acquirer_id' || field_name === 'acquirer_name_raw') {
    return <span>{app.acquirer?.full_name ?? app.acquirer_name_raw ?? '-'}</span>;
  }

  // ステータス / 入金区分: バッジ
  if (field_name === 'status') {
    return app.status ? (
      <Badge>{app.status}</Badge>
    ) : (
      <span className="text-muted-foreground">-</span>
    );
  }
  if (field_name === 'flow_type') {
    return app.flow_type ? (
      <Badge variant="outline">{app.flow_type}</Badge>
    ) : (
      <span className="text-muted-foreground">-</span>
    );
  }

  // --- data_type によるジェネリックレンダリング(extra 列も対応) ---
  const raw = getRaw(app, field);

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
 * app から field に対応する値を取り出す。
 * DB物理カラム(is_in_db=true) / extra(CSV列名, is_in_db=false) 両対応。旧 extra.XXX も後方互換。
 */
function getRaw(app: Application, field: FieldDefinition): unknown {
  const record = app as unknown as Record<string, unknown>;
  if (field.field_name.startsWith('extra.')) {
    const key = field.field_name.slice('extra.'.length);
    return app.extra?.[key] ?? null;
  }
  return getFieldValue(record, field.field_name, field.is_in_db, field.csv_column_name) ?? null;
}
