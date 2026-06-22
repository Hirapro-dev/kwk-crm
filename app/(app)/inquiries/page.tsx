/**
 * 問合せ一覧画面(仕様書 §8.1)
 */

import Link from 'next/link';
import { Suspense } from 'react';
import { SortHeader } from '@/components/layout/SortHeader';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PaginationBar } from '@/components/ui/pagination-link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listForms, listInquiries } from '@/lib/domain/inquiries';
import { formatDateTime } from '@/lib/utils/date';
import { InquiriesFilterBar } from './InquiriesFilterBar';

interface PageProps {
  searchParams: Promise<{
    q?: string;
    form?: string;
    unassigned?: string;
    sort?: string;
    dir?: string;
    page?: string;
  }>;
}

export default async function InquiriesPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const page = Number.parseInt(sp.page ?? '1', 10) || 1;
  const formId = sp.form ? Number.parseInt(sp.form, 10) : undefined;

  const [result, forms] = await Promise.all([
    listInquiries({
      q: sp.q,
      formId,
      unassigned: sp.unassigned === '1',
      sort: sp.sort,
      dir: sp.dir === 'desc' ? 'desc' : 'asc',
      page,
      pageSize: 50,
    }),
    listForms(),
  ]);

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        {/* ヘッダー部: アイコン + タイトル + 件数 */}
        <div className="flex items-start justify-between border-b px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              className="sf-icon-chip"
              style={{ backgroundColor: '#1589ee' }}
              aria-hidden="true"
            >
              INQ
            </span>
            <div className="flex flex-col">
              <h1 className="text-base font-bold text-foreground">問合せ一覧</h1>
              <span className="text-xs text-muted-foreground">
                {result.total.toLocaleString()} 件
              </span>
            </div>
          </div>
        </div>

        {/* フィルター帯 */}
        <div className="border-b px-4 py-2" style={{ backgroundColor: '#f9f9f9' }}>
          <Suspense>
            <InquiriesFilterBar
              initialQ={sp.q ?? ''}
              initialFormId={sp.form ?? ''}
              initialUnassigned={sp.unassigned === '1'}
              forms={forms}
            />
          </Suspense>
        </div>

        {/* テーブル */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead><SortHeader field="id" label="問合せID" /></TableHead>
              <TableHead><SortHeader field="registered_at" label="登録日時" /></TableHead>
              <TableHead><SortHeader field="form_id" label="フォーム" /></TableHead>
              <TableHead><SortHeader field="name" label="氏名" /></TableHead>
              <TableHead><SortHeader field="email" label="メール" /></TableHead>
              <TableHead><SortHeader field="phone" label="電話" /></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  該当する問合せがありません
                </TableCell>
              </TableRow>
            ) : (
              result.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/inquiries/${r.id}`} className="text-primary hover:underline">
                      {r.id}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs">{formatDateTime(r.registered_at)}</TableCell>
                  <TableCell className="text-xs">
                    {r.form ? (
                      <>
                        {r.form.category && (
                          <Badge variant="outline" className="mr-1">
                            {r.form.category}
                          </Badge>
                        )}
                        {r.form.name}
                      </>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell>
                    {r.name ? (
                      r.member ? (
                        <Link
                          href={`/members/${r.member.id}`}
                          className="text-primary hover:underline"
                        >
                          {r.name}
                        </Link>
                      ) : (
                        r.name
                      )
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{r.email ?? '-'}</TableCell>
                  <TableCell className="text-xs">{r.phone ?? '-'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <PaginationBar
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        basePath="/inquiries"
        searchParams={sp}
      />
    </div>
  );
}
