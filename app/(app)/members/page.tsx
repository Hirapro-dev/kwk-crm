/**
 * 会員一覧画面(仕様書 §8.1)
 * Server Component。検索条件は URL クエリで管理。
 */

import { PanelFilterBar, PanelHeader } from '@/components/layout/PanelHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { listMembers } from '@/lib/domain/members';
import { getVisibleFields } from '@/lib/domain/object_metadata';
import { Suspense } from 'react';
import { MembersFilterBar } from './MembersFilterBar';
import { MembersInfinite } from './MembersInfinite';

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

  const dir = sp.dir === 'desc' ? 'desc' : 'asc';
  const memberParams = { q: sp.q, ownerId: sp.owner, sort: sp.sort, dir } as const;

  const [result, listFields] = await Promise.all([
    // 無限スクロール: 初期は1ページ目のみ取得
    listMembers({ ...memberParams, page: 1, pageSize: LIST_PAGE_SIZE }),
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
          無限スクロール表示。一覧/詳細の表示カラムはオブジェクト管理に従う。
          フィルタ・ソート変更時は key で再マウントして初期化する。
        */}
        <MembersInfinite
          key={`${sp.q ?? ''}|${sp.owner ?? ''}|${sp.sort ?? ''}|${dir}`}
          initialRows={result.rows}
          fields={listFields}
          total={result.total}
          params={memberParams}
        />
      </Card>
    </div>
  );
}
