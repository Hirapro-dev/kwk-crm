/**
 * メール受信箱(仕様書 §5.15 / §8.1)
 *
 * スレッド一覧を無限スクロールで表示する。対応歴一覧と同じく、
 * `?view=split` で左に一覧・右にスレッドの分割ビューになる。
 */

import { PanelFilterBar, PanelHeader } from '@/components/layout/PanelHeader';
import { ResizableSplit } from '@/components/layout/ResizableSplit';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { MAIL_STATUSES, type MailStatus, listMailBoxes, listMailThreads } from '@/lib/domain/mail';
import { listAllUsers } from '@/lib/domain/users_admin';
import Link from 'next/link';
import { MailFilterBar } from './MailFilterBar';
import { MailInfinite } from './MailInfinite';
import { MailThreadPanel } from './MailThreadPanel';

interface PageProps {
  searchParams: Promise<{
    q?: string;
    status?: string;
    assignee?: string;
    box?: string;
    unread?: string;
    view?: string;
    selected?: string;
  }>;
}

export default async function MailPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const me = await getCurrentUser();

  const status = MAIL_STATUSES.includes(sp.status as MailStatus)
    ? (sp.status as MailStatus)
    : undefined;
  const mailBoxId = sp.box && /^\d+$/.test(sp.box) ? Number(sp.box) : undefined;

  const listParams = {
    q: sp.q || undefined,
    status,
    assigneeId: sp.assignee || undefined,
    mailBoxId,
    unreadOnly: sp.unread === '1',
  } as const;

  const [result, boxes, users] = await Promise.all([
    listMailThreads({ ...listParams, page: 1, pageSize: LIST_PAGE_SIZE }),
    listMailBoxes(),
    listAllUsers({ activeOnly: true }),
  ]);

  const assigneeOptions = users.map((u) => ({ id: u.id, name: u.full_name ?? u.email }));
  const boxOptions = boxes.map((b) => ({ id: b.id, address: b.address }));

  const isSplit = sp.view === 'split';
  const selected = sp.selected;
  const listKey = `${sp.q ?? ''}|${sp.status ?? ''}|${sp.assignee ?? ''}|${sp.box ?? ''}|${sp.unread ?? ''}`;

  const baseParams = () => {
    const p = new URLSearchParams();
    if (sp.q) p.set('q', sp.q);
    if (sp.status) p.set('status', sp.status);
    if (sp.assignee) p.set('assignee', sp.assignee);
    if (sp.box) p.set('box', sp.box);
    if (sp.unread) p.set('unread', sp.unread);
    return p;
  };
  const toSplitHref = (() => {
    const p = baseParams();
    p.set('view', 'split');
    return `/mail?${p.toString()}`;
  })();
  const toListHref = (() => {
    const qs = baseParams().toString();
    return qs ? `/mail?${qs}` : '/mail';
  })();

  const filterBar = (
    <PanelFilterBar>
      <MailFilterBar
        initialQ={sp.q ?? ''}
        initialStatus={status ?? ''}
        initialAssignee={sp.assignee === me.id ? 'me' : (sp.assignee ?? '')}
        initialBox={mailBoxId ? String(mailBoxId) : ''}
        initialUnread={sp.unread === '1'}
        currentUserId={me.id}
        assigneeOptions={assigneeOptions}
        boxOptions={boxOptions}
      />
    </PanelFilterBar>
  );

  // ---------- 分割ビュー ----------
  if (isSplit) {
    return (
      <ResizableSplit
        className="h-[calc(100dvh-8.5rem)] min-h-[420px]"
        storageKey="mail-split-left-pct"
        left={
          <Card className="flex h-full flex-col overflow-hidden p-0 shadow-sm">
            <PanelHeader
              iconLabel="MAIL"
              iconColor="#5B8DEF"
              viewName="メール"
              totalCount={result.total}
              actions={
                <Link href={toListHref}>
                  <Button variant="outline" size="sm">
                    一覧表示
                  </Button>
                </Link>
              }
            />
            {filterBar}
            <div className="flex min-h-0 flex-1 flex-col">
              <MailInfinite
                key={listKey}
                initialRows={result.rows}
                total={result.total}
                params={listParams}
                splitMode
                selectedId={selected}
              />
            </div>
          </Card>
        }
        right={
          <div className="h-full overflow-y-auto rounded border bg-background p-3 shadow-sm">
            {selected ? (
              <MailThreadPanel threadId={selected} embedded />
            ) : (
              <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
                左の一覧で件名を選ぶと、ここにスレッドが表示されます。
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
          iconLabel="MAIL"
          iconColor="#5B8DEF"
          viewName="メール"
          totalCount={result.total}
          actions={
            <Link href={toSplitHref}>
              <Button variant="outline" size="sm">
                分割ビュー
              </Button>
            </Link>
          }
        />
        {filterBar}
        <MailInfinite
          key={listKey}
          initialRows={result.rows}
          total={result.total}
          params={listParams}
        />
      </Card>
    </div>
  );
}
