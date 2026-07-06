/**
 * 期限切れプロテクトを自動解除する Vercel Cron ジョブ。
 *
 * スケジュール: 毎日 0:00 JST (15:00 UTC) に実行。
 * vercel.json の crons で設定する。
 *
 * 認証: CRON_SECRET 環境変数で保護。
 * Vercel は Authorization: Bearer <CRON_SECRET> ヘッダーを自動付与する。
 */

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { expireProtects } from '@/lib/domain/protect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Vercel Cron からの呼び出しを検証
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServiceRoleClient();
    const expired = await expireProtects(supabase);
    console.info(`[cron/expire-protects] 解除件数: ${expired}`);
    return NextResponse.json({ ok: true, expired });
  } catch (e) {
    console.error('[cron/expire-protects] エラー:', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
