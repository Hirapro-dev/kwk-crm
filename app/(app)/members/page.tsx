/**
 * 会員一覧画面(仕様書 §8.1)
 * Server Component。検索条件は URL クエリで管理。
 */

import Link from 'next/link';
import { Suspense } from 'react';
import { PanelFilterBar, PanelHeader } from '@/components/layout/PanelHeader';
import { DynamicListTable } from '@/components/objects/DynamicListTable';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PaginationBar } from '@/components/ui/pagination-link';
import { getCurrentUser } from '@/lib/domain/auth';
import { listMembers } from '@/lib/domain/members';
import { getVisibleFields } from '@/lib/domain/object_metadata';
import { MembersFilterBar } from './MembersFilterBar';

interface PageProps {
  searchParams: Promise<{
    q?: string;
    owner?: string;
    sort?: string;
    dir?: string;
    page?: string;
  }>;
}

export default async function MembersPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const me = await getCurrentUser();

  const page = Number.parseInt(sp.page ?? '1', 10) || 1;

  const [result, listFields] = await Promise.all([
    listMembers({
      q: sp.q,
      ownerId: sp.owner,
      sort: sp.sort,
      dir: sp.dir === 'desc' ? 'desc' : 'asc',
      page,
      pageSize: 50,
    }),
    // Phase 2: オブジェクト管理 (/settings/objects/members) の表示制御に従う
    getVisibleFields('members', 'list'),
  ]);

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="MEM"
          iconColor="#1589ee"
          viewName="顧客情報一覧"
          totalCount={result.total}
          actions={
            <>
              <Button variant="outline" size="sm">
                インポート
              </Button>
              <Button variant="outline" size="sm">
                リスト編集
              </Button>
              <Button size="sm">新規</Button>
            </>
          }
        />

        <PanelFilterBar>
          <Suspense>
            <MembersFilterBar
              initialQ={sp.q ?? ''}
              initialOwner={sp.owner ?? 'all'}
              currentUserId={me.id}
            />
          </Suspense>
        </PanelFilterBar>

        {/*
          Phase 2: オブジェクト管理画面 (/settings/objects/members) の
          「一覧」表示ONになっているフィールドだけを動的にレンダリングする。
          - 1列目はクリッカブルなリンクとして会員詳細へ遷移できるよう、
            firstColRenderer で値をリンクで囲む。
        */}
        <DynamicListTable
          rows={result.rows as unknown as Record<string, unknown>[]}
          fields={listFields}
          rowKey={(row) => String(row.id)}
          firstColRenderer={(row, field) => {
            const id = String(row.id ?? '');
            // 値を取り出す: DB列なら row[field_name]、extraなら row.extra[field_name]
            const raw = field.is_in_db
              ? row[field.field_name]
              : (row.extra as Record<string, unknown> | null | undefined)?.[field.field_name];
            const text = raw === null || raw === undefined || raw === '' ? id : String(raw);
            return (
              <Link href={`/members/${id}`} className="sf-link font-medium">
                {text}
              </Link>
            );
          }}
          emptyMessage="該当する会員がいません"
        />
      </Card>

      <PaginationBar
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        basePath="/members"
        searchParams={sp}
      />
    </div>
  );
}
