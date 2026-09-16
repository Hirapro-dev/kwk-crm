/**
 * メールスレッド画面(仕様書 §8.1)。左のフォルダはそのまま、右ペインにスレッドを表示する。
 * 上部に「← 前のメール / 次のメール →」。一覧の絞り込み(タブ・受信箱・担当・未読・件名)を
 * URL クエリで引き継ぎ、一覧と同じ並びで前後へ移動する。表示本体は MailThreadPanel。
 */

import { Button } from '@/components/ui/button';
import { getAdjacentMailThreads, listMailBoxes, listMyMailUserFolders } from '@/lib/domain/mail';
import { unsortedBoxIds } from '@/lib/domain/mail_folders';
import { mailTabFilter, resolveMailTab } from '@/lib/domain/mail_tabs';
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
    folder?: string;
  }>;
}

export default async function MailThreadPage({ params, searchParams }: PageProps) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  // 一覧(page.tsx)と同じ解釈で絞り込み条件を組み立てる
  const tab = resolveMailTab(sp.tab);
  const mailBoxId = sp.box && /^\d+$/.test(sp.box) ? Number(sp.box) : undefined;
  // 「その他(未振り分け)」から開いたときは、一覧と同じ受信箱群で前後移動する
  const unsorted = sp.folder === 'unsorted';
  const unsortedIds = unsorted
    ? unsortedBoxIds(await listMailBoxes(), await listMyMailUserFolders())
    : undefined;
  const listParams = {
    q: sp.q || undefined,
    assigneeId: sp.assignee || undefined,
    mailBoxId: unsorted ? undefined : mailBoxId,
    mailBoxIds: unsortedIds,
    unreadOnly: sp.unread === '1',
    importCandidate: sp.folder === 'candidates',
    // 「取込候補」では状態タブを適用しない(一覧と同じ並び・条件で前後移動する)
    ...mailTabFilter(tab, { importCandidate: sp.folder === 'candidates' }),
  } as const;

  const { prevId, nextId } = await getAdjacentMailThreads(id, listParams);

  const qs = (() => {
    const p = new URLSearchParams();
    for (const k of ['tab', 'box', 'folder', 'assignee', 'unread', 'q'] as const) {
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
      {/* 取込候補から開いたときは返信せず取込ルールの設定だけを行う(§5.16) */}
      <MailThreadPanel threadId={id} showReply={sp.folder !== 'candidates'} />
    </div>
  );
}
