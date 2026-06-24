/**
 * 問合せ一覧画面(仕様書 §8.1)
 */

import { Card } from '@/components/ui/card';
import { listForms, listInquiries } from '@/lib/domain/inquiries';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { Suspense } from 'react';
import { InquiriesFilterBar } from './InquiriesFilterBar';
import { InquiriesInfinite } from './InquiriesInfinite';

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
  const formId = sp.form ? Number.parseInt(sp.form, 10) : undefined;

  const [result, forms] = await Promise.all([
    listInquiries({
      q: sp.q,
      formId,
      unassigned: sp.unassigned === '1',
      sort: sp.sort,
      dir: sp.dir === 'desc' ? 'desc' : 'asc',
      page: 1,
      pageSize: LIST_PAGE_SIZE,
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
              style={{ backgroundColor: '#00C896' }}
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

        {/* 無限スクロール表示 */}
        <InquiriesInfinite
          key={`${sp.q ?? ''}|${sp.form ?? ''}|${sp.unassigned ?? ''}|${sp.sort ?? ''}|${sp.dir ?? ''}`}
          initialRows={result.rows}
          total={result.total}
          params={{
            q: sp.q,
            formId,
            unassigned: sp.unassigned === '1',
            sort: sp.sort,
            dir: sp.dir === 'desc' ? 'desc' : 'asc',
          }}
        />
      </Card>
    </div>
  );
}
