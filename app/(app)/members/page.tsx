/**
 * 会員一覧画面(仕様書 §8.1)
 * Server Component。検索条件は URL クエリで管理。
 *
 * 表示モード:
 *   - 通常(既定): 一覧のみ(無限スクロール)
 *   - 分割(?view=split): 左=一覧 / 右=選択会員(?selected)の詳細ペイン
 *     (Salesforce コンソールの分割ビュー相当)
 */

import { PanelFilterBar, PanelHeader } from '@/components/layout/PanelHeader';
import { ResizableSplit } from '@/components/layout/ResizableSplit';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { listMembers } from '@/lib/domain/members';
import { getVisibleFields } from '@/lib/domain/object_metadata';
import Link from 'next/link';
import { Suspense } from 'react';
import { MemberDetailPanel } from './MemberDetailPanel';
import { MembersFilterBar } from './MembersFilterBar';
import { MembersInfinite } from './MembersInfinite';

interface PageProps {
  searchParams: Promise<{
    q?: string;
    owner?: string;
    sort?: string;
    dir?: string;
    page?: string;
    /** 'split' で分割ビュー */
    view?: string;
    /** 分割ビューで右ペインに表示する会員ID */
    selected?: string;
  }>;
}

export default async function MembersPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const me = await getCurrentUser();

  const dir = sp.dir === 'desc' ? 'desc' : 'asc';
  // 担当フィルタの 'me' は自分の UUID に解決してから渡す(protect_by_user_id で絞るため)
  const resolvedOwner = sp.owner === 'me' ? me.id : sp.owner;
  const memberParams = { q: sp.q, ownerId: resolvedOwner, sort: sp.sort, dir } as const;
  const isSplit = sp.view === 'split';
  const selected = sp.selected;

  const [result, listFields] = await Promise.all([
    listMembers({ ...memberParams, page: 1, pageSize: LIST_PAGE_SIZE }),
    getVisibleFields('members', 'list'),
  ]);

  // 表示条件を維持したままモードだけ切り替えるリンクを作る
  const baseParams = () => {
    const p = new URLSearchParams();
    if (sp.q) p.set('q', sp.q);
    if (sp.owner) p.set('owner', sp.owner);
    if (sp.sort) p.set('sort', sp.sort);
    if (sp.dir) p.set('dir', sp.dir);
    return p;
  };
  const toSplitHref = (() => {
    const p = baseParams();
    p.set('view', 'split');
    return `/members?${p.toString()}`;
  })();
  const toListHref = (() => {
    const qs = baseParams().toString();
    return qs ? `/members?${qs}` : '/members';
  })();

  const listKey = `${sp.q ?? ''}|${sp.owner ?? ''}|${sp.sort ?? ''}|${dir}`;

  // ---------- 分割ビュー ----------
  if (isSplit) {
    return (
      <ResizableSplit
        className="h-[calc(100dvh-8.5rem)] min-h-[420px]"
        storageKey="members-split-left-pct"
        left={
          /* 左: 一覧(独立スクロール) */
          <Card className="flex h-full flex-col overflow-hidden p-0 shadow-sm">
            <PanelHeader
              iconLabel="MEM"
              iconColor="#00C896"
              viewName="顧客情報一覧"
              totalCount={result.total}
              actions={
                <Link href={toListHref}>
                  <Button variant="outline" size="sm">
                    一覧表示
                  </Button>
                </Link>
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
            {/* InfiniteTable 自体が内部スクロール(h-full)するため、親では overflow を付けない */}
            <div className="min-h-0 flex-1">
              <MembersInfinite
                key={listKey}
                initialRows={result.rows}
                fields={listFields}
                total={result.total}
                params={memberParams}
                splitMode
                selectedId={selected}
              />
            </div>
          </Card>
        }
        right={
          /* 右: 選択会員の詳細(独立スクロール) */
          <div className="h-full overflow-y-auto rounded border bg-background p-3 shadow-sm">
            {selected ? (
              <MemberDetailPanel memberId={selected} embedded />
            ) : (
              <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
                左の一覧から会員を選ぶと、ここに詳細が表示されます。
              </div>
            )}
          </div>
        }
      />
    );
  }

  // ---------- 通常(一覧のみ) ----------
  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="MEM"
          iconColor="#00C896"
          viewName="顧客情報一覧"
          totalCount={result.total}
          actions={
            /* デスクトップ: ヘッダー右に全ボタン */
            <div className="hidden sm:flex items-center gap-2">
              <Link href={toSplitHref}>
                <Button variant="outline" size="sm">
                  分割ビュー
                </Button>
              </Link>
              <Button variant="outline" size="sm">
                インポート
              </Button>
              <Button variant="outline" size="sm">
                リスト編集
              </Button>
              <Button size="sm">新規</Button>
            </div>
          }
        />
        {/* モバイル: ボタンをヘッダー下段に表示(分割ビューは横幅前提のため除外) */}
        <div className="flex gap-2 border-t px-4 py-2 sm:hidden">
          <Button variant="outline" size="sm">
            インポート
          </Button>
          <Button variant="outline" size="sm">
            リスト編集
          </Button>
          <Button size="sm">新規</Button>
        </div>

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
          key={listKey}
          initialRows={result.rows}
          fields={listFields}
          total={result.total}
          params={memberParams}
        />
      </Card>
    </div>
  );
}
