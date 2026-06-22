/**
 * プロフィール画面 (Topbar 設定プルダウン → プロフィール)
 *
 * 表示内容:
 *   - 基本情報 (氏名・メアド・ロール・状態)
 *   - 氏名変更フォーム (管理者のみ編集可)
 *   - メアド変更フォーム (確認メール送信)
 *   - パスワード変更フォーム (現在PW → 新PW)
 *   - パスワードリセット (メール送信)
 */

import { HighlightPanel } from '@/components/layout/HighlightPanel';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { AccountForms } from './AccountForms';

export default async function AccountPage() {
  const me = await getCurrentUser();
  const isAdmin = me.role === 'admin';

  return (
    <div className="space-y-3">
      <HighlightPanel
        iconLabel="ME"
        iconColor="#1589ee"
        objectLabel="プロフィール"
        recordName={me.full_name ?? me.email}
        recordSubName={me.email}
        facts={[
          { label: 'メール', value: me.email },
          {
            label: '権限',
            value: <Badge variant="outline">{me.role}</Badge>,
          },
          {
            label: '状態',
            value: me.is_active ? (
              <Badge variant="success">有効</Badge>
            ) : (
              <Badge variant="destructive">無効</Badge>
            ),
          },
        ]}
      />

      <Card>
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">基本情報</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
          <InfoRow label="姓">{me.last_name ?? '-'}</InfoRow>
          <InfoRow label="名">{me.first_name ?? '-'}</InfoRow>
          <InfoRow label="フルネーム">{me.full_name ?? '-'}</InfoRow>
          <InfoRow label="メールアドレス">{me.email}</InfoRow>
          <InfoRow label="権限">{me.role}</InfoRow>
          <InfoRow label="状態">{me.is_active ? '有効' : '無効'}</InfoRow>
        </CardContent>
      </Card>

      <AccountForms
        isAdmin={isAdmin}
        currentLastName={me.last_name ?? ''}
        currentFirstName={me.first_name ?? ''}
        currentEmail={me.email}
      />
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col border-b pb-2 last:border-b-0">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}
