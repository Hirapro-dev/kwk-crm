/**
 * メールスレッド画面(仕様書 §8.1)。左のフォルダはそのまま、右ペインにスレッドを表示する。
 * 上部に「← 前のメール / 次のメール →」。一覧の絞り込み(タブ・受信箱・担当・未読・件名)を
 * URL クエリで引き継ぎ、一覧と同じ並びで前後へ移動する。表示本体は MailThreadPanel。
 */

import { Button } from '@/components/ui/button';
import { getAdjacentMailThreads } from '@/lib/domain/mail';
import { resolveMailTab } from '@/lib/domain/mail_tabs';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { MailThreadPanel } from '../MailThreadPanel';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    q?: string;
    tab?: string;
    assignee?: string;
    box?: string;
    unread?: string;
  }>;
}

export default async function MailThreadPage({ params, searchParams }: PageProps) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  // 一覧(page.tsx)と同じ解釈で絞り込み条件を組み立てる
  const tab = resolveMailTab(sp.tab);
  const mailBoxId = sp.box && /^\d+$/.test(sp.box) ? Number(sp.box) : undefined;
  const listParams = {
    q: sp.q || undefined,
    assigneeId: sp.assignee || undefined,
    mailBoxId,
    unreadOnly: sp.unread === '1',
    status: tab.status,
    category: tab.category,
  } as const;

  const { prevId, nextId } = await getAdjacentMailThreads(id, listParams);

  const qs = (() => {
    const p = new URLSearchParams();
    for (const k of ['tab', 'box', 'assignee', 'unread', 'q'] as const) {
      if (sp[k]) p.set(k, sp[k] as string);
    }
    return p.toString();
  })();
  const withQs = (path: string) => (qs ? `${path}?${qs}` : path);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={withQs('/mail')}>
          <Button variant="ghost" size="sm">
            ← 一覧へ戻る
          </Button>
        </Link>
        <div className="flex items-center gap-1">
          {prevId ? (
            <Link href={withQs(`/mail/${prevId}`)}>
              <Button variant="outline" size="sm" aria-label="前のメール">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                前のメール
              </Button>
            </Link>
          ) : (
            <Button variant="outline" size="sm" disabled aria-label="前のメール">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              前のメール
            </Button>
          )}
          {nextId ? (
            <Link href={withQs(`/mail/${nextId}`)}>
              <Button variant="outline" size="sm" aria-label="次のメール">
                次のメール
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Link>
          ) : (
            <Button variant="outline" size="sm" disabled aria-label="次のメール">
              次のメール
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      <MailThreadPanel threadId={id} />
    </div>
  );
}
