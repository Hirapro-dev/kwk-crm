'use server';

import { executeReport, type ExecuteResponse } from '@/lib/reports/execute_v2';
import type { ReportDefinition, ReportTypeId } from '@/lib/reports/types';
import { getCurrentUser } from './auth';

/**
 * ビルダーUI からのプレビュー実行。保存せず実行のみ行う。
 * 仕様書 §9.10: 編集中に随時(debounce 500ms)プレビューする想定。
 */
export async function previewReport(
  reportType: ReportTypeId,
  definition: ReportDefinition,
): Promise<ExecuteResponse> {
  const me = await getCurrentUser();
  // プレビューは先頭100行のみ
  const previewDef: ReportDefinition = {
    ...definition,
    row_limit: 100,
  };
  return executeReport(reportType, previewDef, me.id);
}
