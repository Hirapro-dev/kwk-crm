/**
 * メールスレッド画面(仕様書 §8.1)。表示本体は MailThreadPanel(分割ビューと共通)。
 */

import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { MailThreadPanel } from '../MailThreadPanel';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MailThreadPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <div className="space-y-3">
      <div>
        <Link href="/mail">
          <Button variant="ghost" size="sm">
            ← 受信箱へ戻る
          </Button>
        </Link>
      </div>
      <MailThreadPanel threadId={id} />
    </div>
  );
}
