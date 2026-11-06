/**
 * サマリの入金一覧の CSV ダウンロード(CLAUDE.md §8.1 `/summary`。出力規約は §9.11)
 *
 * GET /summary/payment/export?preset=&from=&to=&project=&active=&user=&sort=&dir=
 *
 * - クエリは入金タブと同じ。画面で絞り込んだ状態(担当者を選んだ状態・並び替えも)のまま出力する
 * - 対象は画面の入金一覧と同じ: 担当者別の合計に数えている申込(paymentListParams)
 * - 列は入金一覧と同じ固定の列(PAYMENT_LIST_FIELDS)。実行ユーザーのセッションで取得するので RLS がそのまま効く
 */

import { APPLICATION_EXPORT_MAX_ROWS, exportApplications } from '@/lib/domain/applications';
import { buildPaymentCsvFilename, toApplicationsCsv } from '@/lib/domain/applications_csv';
import { getCurrentUser } from '@/lib/domain/auth';
import {
  PAYMENT_LIST_FIELDS,
  paymentListParams,
  resolvePaymentSummaryFilter,
} from '@/lib/domain/payment_list';
import { getSalesSummary } from '@/lib/domain/sales_summary';
import { NextResponse } from 'next/server';

export async function GET(request: Request): Promise<Response> {
  // 未ログインは middleware で弾かれるが、念のためここでも確認する
  await getCurrentUser();

  const sp = Object.fromEntries(new URL(request.url).searchParams) as Record<string, string>;
  const { range, projectId, activeFilter } = resolvePaymentSummaryFilter(sp);

  // 画面と同じく、集計の表に出ている担当者を求めてから一覧の絞り込みを決める
  const summary = await getSalesSummary({
    paymentFrom: range.from,
    paymentTo: range.to,
    projectId,
    activeFilter,
  });
  const { selectedUserId: _selected, ...listFilter } = paymentListParams(
    { paymentFrom: range.from, paymentTo: range.to, projectId },
    summary.rows.map((r) => r.user_id),
    sp.user,
  );

  const result = await exportApplications({
    ...listFilter,
    sort: sp.sort,
    dir: sp.dir === 'desc' ? 'desc' : 'asc',
  });

  if (result.tooMany) {
    // 黙って途中まで出すと「全件出た」と誤解されるため、出力せずに絞り込みを促す
    return new NextResponse(
      `入金が ${result.total.toLocaleString()} 件あり、一度に出力できる上限(${APPLICATION_EXPORT_MAX_ROWS.toLocaleString()} 件)を超えています。
期間や案件などで絞り込んでから、もう一度お試しください。`,
      {
        status: 413,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      },
    );
  }

  const filename = buildPaymentCsvFilename(range);
  return new NextResponse(toApplicationsCsv(result.rows, PAYMENT_LIST_FIELDS), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}
