/**
 * /settings 共通レイアウト (管理者専用エリア)。
 *
 * - 全 /settings/* ページの最初に admin ロールチェックを実行
 * - 左サイドメニュー + 右コンテンツの2カラム構成 (Salesforce Setup 風)
 *
 * admin 以外がアクセスした場合は / にリダイレクト。
 */

import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/domain/auth';
import { SettingsSidebar } from './SettingsSidebar';

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentUser();
  if (me.role !== 'admin') {
    redirect('/');
  }

  return (
    <div className="flex min-h-[calc(100vh-88px)] gap-3 rounded border bg-background">
      <SettingsSidebar />
      <div className="flex-1 overflow-y-auto p-4">{children}</div>
    </div>
  );
}
