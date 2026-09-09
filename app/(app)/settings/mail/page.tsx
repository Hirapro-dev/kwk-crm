/**
 * /settings/mail — メール送信設定 (admin 専用 / CLAUDE.md §5.15 M2)
 *
 * 受信箱(mail_boxes)ごとの差出人表示名の既定値を管理する。
 * ここでの値はメーラーの返信・新規作成フォームの初期値になり、
 * 送信者は送信時にその場で書き換えて送ることもできる(既定値は変わらない)。
 * /settings 配下のため layout.tsx で admin チェック済 (二重チェックなし)。
 */

import { PanelHeader } from '@/components/layout/PanelHeader';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listMailBoxes } from '@/lib/domain/mail';
import { getMailAwsConfig } from '@/lib/mail/aws';
import { domainOf, isDomainSendable } from '@/lib/mail/ses_send';
import { MailBoxDisplayNameRow } from './MailBoxDisplayNameRow';

export default async function SettingsMailPage() {
  const boxes = await listMailBoxes();
  const cfg = getMailAwsConfig();
  const rows = await Promise.all(
    boxes.map(async (b) => {
      const domain = domainOf(b.address);
      const sendable = !!cfg && !!domain && (await isDomainSendable(cfg, domain));
      return { ...b, sendable };
    }),
  );

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="MAIL"
          iconColor="#5B8DEF"
          viewName="メール送信設定"
          totalCount={rows.length}
        />
        <div className="border-b px-4 py-3 text-xs text-muted-foreground">
          受信箱ごとの「差出人表示名」の既定値です。メーラーの返信・新規作成では、
          ここでの値が初期値として入り、送信者がその場で書き換えて送ることもできます
          (書き換えても、ここでの既定値は変わりません)。空欄にするとメールアドレスのみが表示されます。
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="h-9">アドレス</TableHead>
              <TableHead className="h-9">差出人表示名(既定)</TableHead>
              <TableHead className="h-9 w-24 text-center">送信</TableHead>
              <TableHead className="h-9 w-24 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  受信箱が登録されていません
                </TableCell>
              </TableRow>
            ) : (
              rows.map((b) => <MailBoxDisplayNameRow key={b.id} box={b} sendable={b.sendable} />)
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
