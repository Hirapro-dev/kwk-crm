/**
 * メーラー(/mail 配下)の共通レイアウト(仕様書 §5.15 / §8.1)。
 *
 * CRM 本体の (app) レイアウト(Topbar + TabsNav)とは別に、
 * メールディーラー風の「上: 黒ヘッダー / 左: 受信箱フォルダ / 右: 一覧・スレッド」構成にする。
 * アプリランチャー(9点アイコン)の「メーラー」から別タブで開く。
 * 認証は middleware + getCurrentUser で CRM 本体と同じ。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import { listMailBoxCounts, listMailBoxes } from '@/lib/domain/mail';
import { groupMailBoxesByDomain, sumMailBoxCounts } from '@/lib/domain/mail_folders';
import { MailFolderSidebar, MailFolderSidebarProvider } from './MailFolderSidebar';
import { MailerTopbar } from './MailerTopbar';

export default async function MailerLayout({ children }: { children: React.ReactNode }) {
  const [me, boxes, counts] = await Promise.all([
    getCurrentUser(),
    listMailBoxes(),
    listMailBoxCounts(),
  ]);
  const groups = groupMailBoxesByDomain(boxes, counts);
  const total = sumMailBoxCounts(counts);

  return (
    <MailFolderSidebarProvider>
      <div className="flex h-dvh flex-col bg-background">
        <MailerTopbar me={me} />
        <div className="flex min-h-0 flex-1">
          <MailFolderSidebar groups={groups} total={total} />
          <main className="min-w-0 flex-1 overflow-y-auto bg-[#f0fffd] p-3">{children}</main>
        </div>
      </div>
    </MailFolderSidebarProvider>
  );
}
