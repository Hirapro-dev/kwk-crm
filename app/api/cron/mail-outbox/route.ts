/**
 * 送信予約(mail_outbox。migration 124)を送る Vercel Cron ジョブ。CLAUDE.md §5.15。
 *
 * スケジュール: 毎分(vercel.json の crons)。承認済みで予約日時を過ぎたメールを送る。
 * 認証: CRON_SECRET(Vercel が Authorization: Bearer <CRON_SECRET> を付ける)。
 */

import { getMailAwsConfig } from '@/lib/mail/aws';
import { deliverDueOutbox } from '@/lib/mail/outbox_deliver';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cfg = getMailAwsConfig();
  if (!cfg) return NextResponse.json({ ok: true, skipped: 'SES 未設定' });

  try {
    const r = await deliverDueOutbox(createServiceRoleClient(), cfg, new Date());
    if (r.sent + r.failed > 0) {
      console.info(`[cron/mail-outbox] 送信 ${r.sent} 件 / 失敗 ${r.failed} 件`);
    }
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error('[cron/mail-outbox] エラー:', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
