/**
 * 「送信済み」「自分の送信履歴」(CLAUDE.md §5.15 / §8.1。2026-10-28 ユーザー要望)。
 * 送ったメールが「対応完了」の中に埋もれないよう、送信メールだけを 1 通ずつ新しい順に並べる。行をクリックするとそのスレッドを開く。
 * - 送信済み(/mail/sent): すべての送信メール(メールディーラーから取り込んだ過去分を含む)。2026-10-28 から左フォルダには出さず、
 *   送信済みは受信箱ごとのタブ(/mail?box=…&tab=sent)で見る(ユーザー指定)。この URL は直接開いたときだけ使う
 * - 自分の送信履歴(/mail/sent?mine=1): 自分が CRM から送ったメール(メールディーラー分は送信者の記録が無いため出ない)
 */

import { Card } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { SENT_PAGE_SIZE, parseSentCursor, sentFolderHref } from '@/lib/domain/mail_sent';
import { listSentMessages } from '@/lib/domain/mail_sent_queries';
import { SentMessagesTable } from '../SentMessagesTable';

interface PageProps {
  searchParams: Promise<{ mine?: string; before?: string }>;
}

export default async function MailSentPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const mine = sp.mine === '1';
  const me = await getCurrentUser();
  const before = parseSentCursor(sp.before);
  const { rows, hasMore, error } = await listSentMessages({
    senderUserId: mine ? me.id : undefined,
    before,
    limit: SENT_PAGE_SIZE,
  });

  return (
    <Card className="overflow-hidden p-0 shadow-sm">
      <div className="border-b px-3 py-2">
        <h1 className="text-base font-semibold">{mine ? '自分の送信履歴' : '送信済み'}</h1>
        <p className="text-xs text-muted-foreground">
          {mine
            ? '自分が CRM から送ったメールです(新しい順)。メールディーラーで送った過去のメールは、送信者の記録が無いためここには出ません。'
            : '送ったメールです(新しい順。メールディーラーから取り込んだ過去の送信も含みます)。件名をクリックするとスレッドを開きます。'}
        </p>
      </div>

      <SentMessagesTable
        rows={rows}
        hasMore={hasMore}
        error={error}
        isContinued={before !== null}
        firstHref={sentFolderHref({ mine })}
        nextHref={(b) => sentFolderHref({ mine, before: b })}
      />
    </Card>
  );
}
