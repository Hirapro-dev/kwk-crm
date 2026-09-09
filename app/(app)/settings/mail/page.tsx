/**
 * /settings/mail — メール設定 (admin 専用 / CLAUDE.md §5.15 M2)
 *
 * メールディーラーから CRM への移行で「アドレスを増やす」作業をシステム内で完結に近づける画面。
 *   1. 転送先(受信用アドレス): 各サーバー(Xserver 等)の転送設定に貼る値と手順
 *   2. 受信箱(mail_boxes): 追加・表示名・署名・有効/無効
 *   3. 送信ドメイン: SES への登録(ボタン)と、DNS に貼る DKIM の CNAME 3本、検証状態
 * DNS の追加と各サーバーの転送設定は API が無いため手作業(ここに案内を出す)。
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
import { uniqueDomains } from '@/lib/domain/mail_box_settings';
import { domainOfAddress } from '@/lib/domain/mail_folders';
import { getMailAwsConfig } from '@/lib/mail/aws';
import { type DomainIdentity, getDomainIdentity } from '@/lib/mail/ses_identity';
import { CopyButton } from './CopyButton';
import { DomainCard } from './DomainCard';
import { MailBoxRow } from './MailBoxRow';
import { NewMailBoxForm } from './NewMailBoxForm';

export default async function SettingsMailPage() {
  const boxes = await listMailBoxes();
  const cfg = getMailAwsConfig();
  const domains = uniqueDomains(boxes.map((b) => b.address));

  // ドメインごとの SES 検証状態(SES 未設定なら unknown)
  const identities: DomainIdentity[] = await Promise.all(
    domains.map((d) =>
      cfg
        ? getDomainIdentity(cfg, d)
        : Promise.resolve<DomainIdentity>({
            domain: d,
            status: 'unknown',
            dkimTokens: [],
            detail: '送信基盤(SES)の環境変数が未設定です',
          }),
    ),
  );
  const statusByDomain = new Map(identities.map((i) => [i.domain, i]));
  const inboundAddress = cfg?.inboundAddress ?? null;

  return (
    <div className="space-y-3">
      {/* 1. 転送先 */}
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader iconLabel="MAIL" iconColor="#5B8DEF" viewName="メール設定" />
        <div className="space-y-2 px-4 py-3 text-xs text-muted-foreground">
          <p>
            共有アドレスを CRM で受信するには、そのアドレスのサーバー(Xserver
            等)の転送設定に、下の受信用アドレスを追加します。転送は「メールボックスに残す」にしてください
            (メールディーラーへの転送と併用できます)。
          </p>
          {inboundAddress ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border bg-gray-50 px-2 py-1 font-mono text-sm text-foreground">
                {inboundAddress}
              </span>
              <CopyButton text={inboundAddress} label="転送先をコピー" />
            </div>
          ) : (
            <p className="text-red-600">
              受信用アドレス(MAIL_INBOUND_ADDRESS)が未設定です。Vercel
              の環境変数を確認してください。
            </p>
          )}
          <ol className="list-decimal space-y-0.5 pl-5">
            <li>
              下の「受信箱」にそのアドレスを追加する(CRM がどの受信箱に入れるかの判定に使います)
            </li>
            <li>
              Xserver サーバーパネル → メールアカウント設定 →
              対象アドレスの「転送設定」に上の受信用アドレスを追加
            </li>
            <li>
              返信もしたい場合は、下の「送信ドメイン」でドメインを SES に登録し、DNS に CNAME
              3本を追加
            </li>
          </ol>
        </div>
      </Card>

      {/* 2. 受信箱 */}
      <NewMailBoxForm />
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="BOX"
          iconColor="#5B8DEF"
          viewName="受信箱(共有アドレス)"
          totalCount={boxes.length}
        />
        <div className="border-b px-4 py-2 text-xs text-muted-foreground">
          差出人表示名はメーラーの返信・新規作成フォームの初期値になります(送信者がその場で書き換えても、ここでの既定値は変わりません)。
          署名は送信時に本文の末尾に自動で付きます。無効にした受信箱は新しいメールを受け付けず、送信元にも選べません(過去のスレッドは残ります)。
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
              <TableHead className="h-9">アドレス</TableHead>
              <TableHead className="h-9">差出人表示名(既定)</TableHead>
              <TableHead className="h-9">署名</TableHead>
              <TableHead className="h-9 w-16 text-center">有効</TableHead>
              <TableHead className="h-9 w-24 text-center">送信</TableHead>
              <TableHead className="h-9 w-24 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {boxes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  受信箱が登録されていません。上のフォームから追加してください。
                </TableCell>
              </TableRow>
            ) : (
              boxes.map((b) => (
                <MailBoxRow
                  key={b.id}
                  box={b}
                  domainStatus={statusByDomain.get(domainOfAddress(b.address))?.status ?? 'unknown'}
                />
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* 3. 送信ドメイン */}
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="DKIM"
          iconColor="#04844b"
          viewName="送信ドメイン(SES の検証状態)"
          totalCount={identities.length}
        />
        <div className="border-b px-4 py-2 text-xs text-muted-foreground">
          ドメインごとに一度だけ、SES に登録して DNS に CNAME
          を3本追加すると、そのドメインの全アドレスから送信できるようになります。 DNS の反映後、SES
          が自動で確認します(通常 1 時間以内)。「再確認」で最新の状態を取り直せます。
        </div>
        <div className="space-y-3 p-4">
          {identities.length === 0 && (
            <p className="text-sm text-muted-foreground">
              受信箱を追加すると、そのドメインがここに表示されます。
            </p>
          )}
          {identities.map((i) => (
            <DomainCard key={i.domain} identity={i} sesConfigured={!!cfg} />
          ))}
        </div>
      </Card>
    </div>
  );
}
