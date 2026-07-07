'use client';

import { type InfiniteCol, InfiniteTable } from '@/components/layout/InfiniteTable';
import { PhoneLink } from '@/components/layout/PhoneLink';
import { TableCell } from '@/components/ui/table';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { loadMoreMembers } from '@/lib/domain/list_more_actions';
import type { FieldDefinition } from '@/lib/domain/object_metadata';
import type { MemberWithOwner } from '@/lib/domain/types';
import { formatFieldValue, getFieldValue } from '@/lib/utils/format_field';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

interface Props {
  initialRows: MemberWithOwner[];
  fields: FieldDefinition[];
  total: number;
  params: { q?: string; ownerId?: string; sort?: string; dir?: 'asc' | 'desc' };
  /** 分割ビュー: 行クリックで詳細ページに遷移せず、右ペインに詳細を出す(URL の selected を差し替え) */
  splitMode?: boolean;
  /** 分割ビューで現在選択中の会員ID(選択行ハイライト用) */
  selectedId?: string;
}

export function MembersInfinite({
  initialRows,
  fields,
  total,
  params,
  splitMode,
  selectedId,
}: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 分割ビュー用: 現在のクエリを維持したまま selected を差し替えるリンク先を作る
  const buildSelectHref = (id: string) => {
    const p = new URLSearchParams(searchParams?.toString() ?? '');
    p.set('view', 'split');
    p.set('selected', id);
    return `${pathname}?${p.toString()}`;
  };
  /** 会員詳細への遷移先。分割ビューでは selected 差し替え、通常はフルページ詳細。 */
  const detailHref = (id: string) => (splitMode ? buildSelectHref(id) : `/members/${id}`);

  const columns: InfiniteCol[] = fields.map((f) => ({
    header: f.label ?? f.field_name,
    sortField: f.is_in_db ? f.field_name : undefined,
  }));

  const renderRow = (m: MemberWithOwner) => {
    const rec = m as unknown as Record<string, unknown>;
    const id = String(rec.id ?? '');
    return fields.map((f, i) => {
      // --- フィールド名による特定処理（位置より優先） ---

      // 氏名: 詳細リンク付き
      if (f.field_name === 'name') {
        const name = rec.name as string | null | undefined;
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
            <Link
              href={detailHref(id)}
              scroll={!splitMode}
              replace={splitMode}
              className={i === 0 ? 'sf-link font-medium' : 'sf-link'}
            >
              {name ?? '-'}
            </Link>
          </TableCell>
        );
      }

      // プロテクト: ユーザー名 + ユーザー詳細リンク
      if (f.field_name === 'protect_by_user_id') {
        const protectUser = m.protect_by_user;
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
            {protectUser ? (
              <Link href={`/settings/users/${protectUser.id}`} className="sf-link">
                {protectUser.full_name ?? 'free'}
              </Link>
            ) : (
              <span className="text-muted-foreground">free</span>
            )}
          </TableCell>
        );
      }

      // --- 1列目: 詳細リンク付き（フィールド値 or 会員ID） ---
      if (i === 0) {
        const raw = f.is_in_db
          ? rec[f.field_name]
          : (rec.extra as Record<string, unknown> | null | undefined)?.[f.field_name];
        const text = raw === null || raw === undefined || raw === '' ? id : String(raw);
        return (
          <TableCell key={f.id} className="whitespace-nowrap py-2">
            <Link
              href={detailHref(id)}
              scroll={!splitMode}
              replace={splitMode}
              className="sf-link font-medium"
            >
              {text}
            </Link>
          </TableCell>
        );
      }

      // --- 汎用レンダリング ---
      const raw = getFieldValue(rec, f.field_name, f.is_in_db, f.csv_column_name);
      const formatted = formatFieldValue(raw, f.data_type, f.label ?? f.field_name);
      const isPhone = f.field_name === 'phone1' || f.field_name === 'phone';
      return (
        <TableCell key={f.id} className="whitespace-nowrap py-2 text-sm">
          {isPhone && formatted ? <PhoneLink value={formatted} /> : formatted}
        </TableCell>
      );
    });
  };

  if (fields.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        表示するカラムが選択されていません。
      </p>
    );
  }

  return (
    <InfiniteTable
      initialRows={initialRows}
      total={total}
      pageSize={LIST_PAGE_SIZE}
      loadMore={(page) => loadMoreMembers(params, page)}
      columns={columns}
      renderRow={renderRow}
      getKey={(m) => String((m as unknown as Record<string, unknown>).id)}
      emptyMessage="該当する会員がいません"
      // 分割ビューでは左ペインの高さいっぱいをスクロール領域にする(通常時は既定の高さ)
      fillParent={splitMode}
      rowClassName={(m) =>
        splitMode &&
        selectedId &&
        String((m as unknown as Record<string, unknown>).id) === selectedId
          ? 'bg-primary/10'
          : undefined
      }
    />
  );
}
