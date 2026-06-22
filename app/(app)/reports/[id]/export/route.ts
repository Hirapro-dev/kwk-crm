/**
 * レポート CSV / Excel ダウンロード(仕様書 §9.11)
 *
 * GET /reports/[id]/export?format=csv|xlsx
 *
 * - CSV: UTF-8 BOM 付き、日付は YYYY/MM/DD HH:mm
 * - Excel: 50,000 行まで(builder の MAX_EXCEL_ROW_LIMIT)
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/domain/auth';
import { logReportRun } from '@/lib/domain/report_actions';
import { getReport } from '@/lib/domain/reports';
import { executeReport } from '@/lib/reports/execute_v2';
import { toCsv, toXlsx } from '@/lib/reports/export_v2';
import type { ReportTypeId } from '@/lib/reports/types';

type Params = { id: string };

export async function GET(
  request: Request,
  { params }: { params: Promise<Params> },
): Promise<Response> {
  const { id } = await params;
  const url = new URL(request.url);
  const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';

  const report = await getReport(id);
  if (!report) {
    return new NextResponse('Report not found', { status: 404 });
  }
  const me = await getCurrentUser();

  const reportType = (report.report_type === 'custom' ? 'RT01' : report.report_type) as ReportTypeId;

  const res = await executeReport(reportType, report.definition, me.id, {
    excelMode: format === 'xlsx',
  });

  await logReportRun({
    report_id: report.id,
    duration_ms: res.ok ? res.durationMs : 0,
    row_count: res.ok ? res.rowCount : 0,
    status: res.ok ? 'success' : 'error',
    error_message: res.ok ? undefined : res.error,
  });

  if (!res.ok) {
    return new NextResponse(`Export failed: ${res.error}`, { status: 500 });
  }

  const filenameBase = report.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);

  if (format === 'csv') {
    const body = toCsv(res);
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${filenameBase}.csv`)}`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const bytes = toXlsx(res, filenameBase);
  return new NextResponse(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${filenameBase}.xlsx`)}`,
      'Cache-Control': 'no-store',
    },
  });
}
