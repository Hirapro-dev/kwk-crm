/**
 * 対応歴 CSV ダウンロード(仕様書 §8.1 / 出力規約は §9.11 に準拠)
 *
 * GET /activities/export?member=&d=&m=&s=&owner=&from=&to=
 *
 * - クエリパラメータは対応歴一覧(/activities)と同じ。画面で絞り込んだ状態のまま
 *   ボタンを押せば、その条件で出力される
 * - 取得は exportActivities(一覧と同じ絞り込み・並び順を共有)
 * - 実行ユーザーのセッションで取得するため、RLS がそのまま効く
 */

import {
  ACTIVITY_EXPORT_MAX_ROWS,
  type ActivityListParams,
  exportActivities,
} from '@/lib/domain/activities';
import { buildActivitiesCsvFilename, toActivitiesCsv } from '@/lib/domain/activities_csv';
import { getCurrentUser } from '@/lib/domain/auth';
import { NextResponse } from 'next/server';

export async function GET(request: Request): Promise<Response> {
  // 未ログインは middleware で弾かれるが、念のためここでも確認する
  await getCurrentUser();

  const sp = new URL(request.url).searchParams;
  const from = sp.get('from') || undefined;
  const to = sp.get('to') || undefined;

  // 一覧ページ(page.tsx)と同じ組み立て。日付は JST の 0:00〜23:59:59 として解釈する
  const params: ActivityListParams = {
    memberId: sp.get('member') || undefined,
    dBunrui: sp.get('d') || undefined,
    mBunrui: sp.get('m') || undefined,
    sBunrui: sp.get('s') || undefined,
    ownerId: sp.get('owner') || undefined,
    from: from ? `${from}T00:00:00+09:00` : undefined,
    to: to ? `${to}T23:59:59+09:00` : undefined,
  };

  const result = await exportActivities(params);

  if (result.tooMany) {
    // 黙って途中まで出すと「全件出た」と誤解されるため、出力せずに絞り込みを促す
    return new NextResponse(
      `対応歴が ${result.total.toLocaleString()} 件あり、一度に出力できる上限(${ACTIVITY_EXPORT_MAX_ROWS.toLocaleString()} 件)を超えています。
期間や担当者などで絞り込んでから、もう一度お試しください。`,
      {
        status: 413,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      },
    );
  }

  const filename = buildActivitiesCsvFilename({ from, to });

  return new NextResponse(toActivitiesCsv(result.rows), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}
