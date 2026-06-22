/**
 * 移行スクリプト 03: フォームマスタ(forms) — 実 CSV 列名対応版
 * 仕様書 §4.1 §5.2 §6.1 Phase 1
 *
 * 入力: KAWARA版関連.csv + 機密保持_CP.csv の「フォーム名」列をユニーク抽出
 * 出力: public.forms
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs } from './lib/args';
import { readCsv } from './lib/csv';
import { createMigrateClient } from './lib/db';
import { getEnv } from './lib/env';
import { writeErrors, type ErrorRecord } from './lib/error_writer';
import { logger } from './lib/logger';
import { nz } from './lib/normalizers';

const SCRIPT_NAME = '03_forms';
const DEFAULT_CSVS = ['KAWARA版関連.csv', '機密保持_CP.csv'];

type Category = '特別レポート' | '投資案件調査' | '機密保持' | 'ステップメール' | 'その他';

interface FormRow {
  name: string;
  category: Category;
  description: string | null;
  is_active: boolean;
}

function classify(name: string): Category {
  if (name.includes('特別レポート') || name.includes('レポート')) return '特別レポート';
  if (name.includes('機密保持') || name.includes('CP') || name.includes('NDA')) return '機密保持';
  if (name.includes('ステップメール') || name.includes('ステップ')) return 'ステップメール';
  if (name.includes('調査') || name.includes('案件')) return '投資案件調査';
  return 'その他';
}

/**
 * 実 CSV では「フォーム名」列。
 */
function extractFormName(row: Record<string, string>): string | null {
  return nz(
    row['フォーム名'] ?? row['フォーム種別'] ?? row['Form_Type__c'] ?? row['form_type'],
  );
}

async function loadFormsFromCsv(csvPath: string): Promise<Map<string, number>> {
  const counter = new Map<string, number>();
  if (!existsSync(csvPath)) {
    logger.warn(`CSV未配置(スキップ): ${csvPath}`);
    return counter;
  }
  const rows = readCsv(csvPath, { trimValues: true });
  logger.info(`${csvPath}: ${rows.length}行`);
  for (const r of rows) {
    const name = extractFormName(r);
    if (!name) continue;
    counter.set(name, (counter.get(name) ?? 0) + 1);
  }
  return counter;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const env = getEnv();

  const csvPaths = args.file
    ? [resolve(process.cwd(), args.file)]
    : DEFAULT_CSVS.map((f) => resolve(process.cwd(), `${env.sourceDir}/${f}`));

  logger.info(`移行開始: ${SCRIPT_NAME}`, { csvs: csvPaths, dryRun: args.dryRun });

  const totalCounter = new Map<string, number>();
  for (const p of csvPaths) {
    const c = await loadFormsFromCsv(p);
    for (const [k, v] of c) {
      totalCounter.set(k, (totalCounter.get(k) ?? 0) + v);
    }
  }

  const forms: FormRow[] = [...totalCounter.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ja'))
    .map(([name, count]) => ({
      name,
      category: classify(name),
      description: `元データ出現回数: ${count}`,
      is_active: true,
    }));

  if (args.limit) forms.length = Math.min(forms.length, args.limit);

  logger.info(`抽出フォーム種別: ${forms.length}件`);
  const byCategory = forms.reduce<Record<string, number>>((acc, f) => {
    acc[f.category] = (acc[f.category] ?? 0) + 1;
    return acc;
  }, {});
  logger.info('カテゴリ分布', byCategory);

  if (args.dryRun) {
    logger.info('--dry-run: DB 投入はスキップ');
    for (const f of forms.slice(0, 10)) {
      logger.info('  ' + JSON.stringify(f));
    }
    return;
  }

  const supabase = createMigrateClient();
  const errors: ErrorRecord[] = [];

  const { error } = await supabase
    .from('forms')
    .upsert(forms, { onConflict: 'name', ignoreDuplicates: false });

  if (error) {
    logger.error('一括投入失敗、1件ずつretry', { message: error.message });
    let inserted = 0;
    let failed = 0;
    for (const f of forms) {
      const { error: se } = await supabase.from('forms').upsert([f], { onConflict: 'name' });
      if (se) {
        failed++;
        errors.push({ name: f.name, category: f.category, _error: se.message });
      } else {
        inserted++;
      }
    }
    logger.info(`Retry結果: 成功=${inserted}, 失敗=${failed}`);
  } else {
    logger.info(`投入完了: ${forms.length}件`);
  }

  if (errors.length > 0) {
    const errPath = writeErrors(`${SCRIPT_NAME}_errors.csv`, errors);
    logger.warn(`エラーCSV出力: ${errPath}`);
  }

  const { count } = await supabase
    .from('forms')
    .select('id', { count: 'exact', head: true });
  logger.info(`DB 件数: ${count}`);
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
