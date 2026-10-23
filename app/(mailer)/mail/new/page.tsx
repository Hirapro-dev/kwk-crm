/**
 * メール新規作成(仕様書 §8.1 / §5.15 M2)。
 * 差出人は受信箱(mail_boxes)から選ぶ。SES でドメイン未検証の受信箱は選べない。
 */

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentUser } from '@/lib/domain/auth';
import { listMailBoxes, listMailSignatures } from '@/lib/domain/mail';
import { splitOtherMailBox } from '@/lib/domain/mail_folders';
import { canDirectSend } from '@/lib/domain/mail_outbox';
import { getMailAwsConfig } from '@/lib/mail/aws';
import { domainOf, sendableDomainMap } from '@/lib/mail/ses_send';
import Link from 'next/link';
import { type ComposeBoxOption, MailComposeForm } from './MailComposeForm';

interface PageProps {
  searchParams: Promise<{ to?: string }>;
}

export default async function MailNewPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const me = await getCurrentUser();
  const cfg = getMailAwsConfig();
  const [allBoxes, allSignatures] = await Promise.all([listMailBoxes(), listMailSignatures()]);
  const { rest: boxes } = splitOtherMailBox(allBoxes);
  // 署名は署名マスタの有効なものだけ選べる
  const signatures = allSignatures.filter((s) => s.is_active);

  // 送信可否はドメインごとに 1 回だけ調べる(受信箱ごとに同時に問い合わせると SES に断られ、検証済みでも「受信専用」になっていた)
  const activeBoxes = boxes.filter((b) => b.is_active);
  const sendableByDomain = cfg
    ? await sendableDomainMap(
        cfg,
        activeBoxes.map((b) => b.address),
      )
    : new Map<string, boolean>();
  const options: ComposeBoxOption[] = activeBoxes.map((b) => {
    const domain = domainOf(b.address);
    return {
      id: b.id,
      address: b.address,
      display_name: b.display_name,
      default_signature_id: b.default_signature_id,
      sendable: !!domain && sendableByDomain.get(domain) === true,
    };
  });

  return (
    <div className="space-y-3">
      <div>
        <Link href="/mail">
          <Button variant="ghost" size="sm">
            ← 一覧へ戻る
          </Button>
        </Link>
      </div>
      <Card className="overflow-hidden p-0 shadow-sm">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-base">メールを新規作成</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {me.role === 'viewer' ? (
            <p className="text-sm text-muted-foreground">閲覧専用ユーザーは送信できません。</p>
          ) : !cfg ? (
            <p className="text-sm text-muted-foreground">送信基盤(SES)が未設定です。</p>
          ) : (
            <MailComposeForm
              boxes={options}
              signatures={signatures}
              initialTo={sp.to}
              canDirectSend={canDirectSend(me.role)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
