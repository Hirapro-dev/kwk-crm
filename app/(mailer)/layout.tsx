/**
 * メーラー(/mail 配下)の共通レイアウト(仕様書 §5.15 / §8.1)。
 *
 * CRM 本体の (app) レイアウト(Topbar + TabsNav)とは別に、
 * メールディーラー風の「上: 黒ヘッダー / 左: 受信箱フォルダ / 右: 一覧・スレッド」構成にする。
 * アプリランチャー(9点アイコン)の「メーラー」から別タブで開く。
 * 認証は middleware + getCurrentUser で CRM 本体と同じ。
 */

import { getCurrentUser } from '@/lib/domain/auth';
import {
  countMailThreads,
  listMailBoxCounts,
  listMailBoxes,
  listMyMailBoxPins,
  listMyMailUserFolders,
} from '@/lib/domain/mail';
import {
  groupMailBoxesByDomain,
  pinnedFolderItems,
  splitOtherMailBox,
  sumMailBoxCounts,
  userFolderSections,
} from '@/lib/domain/mail_folders';
import { MailFolderSidebar, MailFolderSidebarProvider } from './MailFolderSidebar';
import { MailerTopbar } from './MailerTopbar';

export default async function MailerLayout({ children }: { children: React.ReactNode }) {
  const [me, boxes, counts, candidatePending, candidateUnread, pinIds, userFolders] =
    await Promise.all([
      getCurrentUser(),
      listMailBoxes(),
      listMailBoxCounts(),
      // 「取込候補」(migration 82)は受信箱をまたぐ絞り込みなので、受信箱別の集計とは別に数える
      countMailThreads({ importCandidate: true, status: '未対応' }),
      countMailThreads({ importCandidate: true, unreadOnly: true }),
      listMyMailBoxPins(),
      listMyMailUserFolders(),
    ]);
  const candidateFolder = { pendingCount: candidatePending, unreadCount: candidateUnread };
  // 「その他」(未登録アドレス宛。migration 78)はドメイン階層に混ぜず、固定項目として出す
  const { other, rest } = splitOtherMailBox(boxes);
  const groups = groupMailBoxesByDomain(rest, counts);
  // 自分のピン留め(migration 84)。ピン留めした順に、件数付きで上部に出す
  const pinned = pinnedFolderItems(groups, pinIds);
  // 自分のマイフォルダ(migration 92)。受信箱をドラッグ&ドロップで整理する区画
  const folders = userFolderSections(groups, userFolders);
  const total = sumMailBoxCounts(counts);
  const otherCount = other ? counts.find((c) => c.mail_box_id === other.id) : undefined;
  const otherBox = other
    ? {
        id: other.id,
        pendingCount: Number(otherCount?.pending_count ?? 0),
        unreadCount: Number(otherCount?.unread_count ?? 0),
      }
    : null;

  return (
    <MailFolderSidebarProvider>
      <div className="flex h-dvh flex-col bg-background">
        <MailerTopbar me={me} />
        <div className="flex min-h-0 flex-1">
          <MailFolderSidebar
            groups={groups}
            total={total}
            otherBox={otherBox}
            candidateFolder={candidateFolder}
            pinned={pinned}
            folders={folders}
          />
          <main className="min-w-0 flex-1 overflow-y-auto bg-[#f0fffd] p-3">{children}</main>
        </div>
      </div>
    </MailFolderSidebarProvider>
  );
}
