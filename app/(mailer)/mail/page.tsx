/**
 * メーラー: メール一覧(仕様書 §5.15 / §8.1)
 *
 * メールディーラー風の構成。左のフォルダ(layout)で受信箱を選び、
 * ここでは状態タブ(新着 / 対応中 / 対応完了 / すべて / メルマガ / 自動応答 / 迷惑メール)と
 * 担当・未読・件名で絞り込んだスレッド一覧を無限スクロールで表示する。
 * 件名クリックでスレッド画面(/mail/[id])へ。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { LIST_PAGE_SIZE } from '@/lib/domain/list_constants';
import { countMailThreads, listMailBoxes, listMailThreads } from '@/lib/domain/mail';
import { MAIL_TABS, resolveMailTab } from '@/lib/domain/mail_tabs';
import { listAllUsers } from '@/lib/domain/users_admin';
import { MailFilterBar } from './MailFilterBar';
import { MailInfinite } from './MailInfinite';
import { MailStatusTabs } from './MailStatusTabs';

interface PageProps {
  searchParams: Promise<{
    q?: string;
    tab?: string;
    assignee?: string;
    box?: string;
    unread?: string;
    from?: string;
    to?: string;
  }>;
}

export default async function MailPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const me = await getCurrentUser();

  const tab = resolveMailTab(sp.tab);
  const mailBoxId = sp.box && /^\d+$/.test(sp.box) ? Number(sp.box) : undefined;

  // タブ以外の絞り込み(担当・未読・検索語・期間・受信箱)。タブ件数はこの条件で数える
  const baseParams = {
    q: sp.q || undefined,
    assigneeId: sp.assignee || undefined,
    mailBoxId,
    unreadOnly: sp.unread === '1',
    dateFrom: sp.from || undefined,
    dateTo: sp.to || undefined,
  } as const;
  const listParams = { ...baseParams, status: tab.status, category: tab.category } as const;

  const [result, boxes, users, tabCounts] = await Promise.all([
    listMailThreads({ ...listParams, page: 1, pageSize: LIST_PAGE_SIZE }),
    listMailBoxes(),
    listAllUsers({ activeOnly: true }),
    Promise.all(
      MAIL_TABS.map((t) =>
        countMailThreads({ ...baseParams, status: t.status, category: t.category }),
      ),
    ),
  ]);

  const assigneeOptions = users.map((u) => ({ id: u.id, name: u.full_name ?? u.email }));
  const currentBox = mailBoxId ? boxes.find((b) => b.id === mailBoxId) : undefined;
  const title = currentBox
    ? currentBox.display_name
      ? `${currentBox.display_name} <${currentBox.address}>`
      : currentBox.address
    : 'すべての受信箱';
  const listKey = `${tab.key}|${sp.q ?? ''}|${sp.assignee ?? ''}|${sp.box ?? ''}|${sp.unread ?? ''}|${sp.from ?? ''}|${sp.to ?? ''}`;

  return (
    <div className="flex h-full min-h-0 flex-col rounded border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-bold">{title}</h1>
          <p className="text-[11px] text-muted-foreground">
            {tab.label}: {result.total.toLocaleString()} 件
          </p>
        </div>
        <MailFilterBar
          initialQ={sp.q ?? ''}
          initialAssignee={sp.assignee === me.id ? 'me' : (sp.assignee ?? '')}
          initialUnread={sp.unread === '1'}
          initialDateFrom={sp.from ?? ''}
          initialDateTo={sp.to ?? ''}
          currentUserId={me.id}
          assigneeOptions={assigneeOptions}
        />
      </div>

      <MailStatusTabs
        current={tab.key}
        counts={Object.fromEntries(MAIL_TABS.map((t, i) => [t.key, tabCounts[i] ?? 0]))}
        searchParams={sp}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <MailInfinite
          key={listKey}
          initialRows={result.rows}
          total={result.total}
          params={listParams}
          showBoxColumn={!mailBoxId}
          boxAddresses={Object.fromEntries(boxes.map((b) => [b.id, b.address]))}
        />
      </div>
    </div>
  );
}
