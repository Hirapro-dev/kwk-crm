/**
 * Phase 1.5: 全CSV のヘッダーを読み取り、field_definitions に UPSERT するスクリプト。
 *
 * 目的:
 *   オブジェクト管理画面 (/settings/objects/[id]) で全カラムを管理対象にするため、
 *   DB物理カラムに無いCSV列も field_definitions に登録する。
 *
 * 仕様:
 *   - DB物理カラムにマッピング済の CSV 列 → field_name=DB列名, is_in_db=true
 *   - マッピングされていない CSV 列 → field_name="extra_NNN" 連番, is_in_db=false, csv_column_name=元のCSV列
 *   - ラベルは CSV 列名そのまま (label カラム)
 *   - 既存レコードは更新しない (UPSERT で ON CONFLICT DO NOTHING)、ラベルや表示設定を保持
 *   - デフォルト表示: is_visible_list=false (170列を全部表示すると破綻するため)、is_visible_detail=true
 *
 * 実行: npm run seed:fields
 *       npm run seed:fields -- --dry-run
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs } from '../migrate/lib/args';
import { readCsv } from '../migrate/lib/csv';
import { createMigrateClient } from '../migrate/lib/db';
import { logger } from '../migrate/lib/logger';

interface CsvTarget {
  /** object_definitions.id */
  objectId: string;
  /** CSV ファイル (csv/ 配下) */
  csvFile: string;
  /** CSV 列名 → DB 物理カラム名 のマッピング (既存 02_members.ts 等で取り込んでいるもの) */
  mapping: Record<string, string>;
}

/**
 * CSVファイルのヘッダー1行を取得する簡易関数。
 * 大容量CSVでも全行読み込まずヘッダーだけ取れる。
 */
function readCsvHeaders(path: string): string[] {
  const rows = readCsv(path, { trimValues: true });
  if (rows.length === 0) return [];
  return Object.keys(rows[0]!);
}

// 各CSV → DB物理カラムのマッピング
// (既存の scripts/migrate/*.ts で実装されている取込ロジックと一致させる)
const TARGETS: CsvTarget[] = [
  // ----- projects (anken_csv) -----
  {
    objectId: 'projects',
    csvFile: 'anken_csv.csv',
    mapping: {
      案件ID: 'id',
      案件: 'name',
      使用中フラグ: 'is_active',
    },
  },

  // ----- members (kaiin_csv) -----
  {
    objectId: 'members',
    csvFile: 'kaiin_csv.csv',
    mapping: {
      会員ID: 'id',
      永久担当: 'owner_name_raw',
      実質名義人: 'real_name',
      会員氏名: 'name',
      会員かな: 'name_kana',
      'Eメール1': 'email1',
      'Eメール2': 'email2',
      'Eメール3': 'email3',
      電話番号1: 'phone1',
      ' 住所(フル）': 'address',
      '住所(フル）': 'address',
      顧客種別: 'customer_type',
      総合計額: 'total_amount',
      総合計実入金額: 'total_paid_amount',
      総利用額合計: 'total_used_amount',
      広告ID: 'ad_id',
      広告媒体名: 'ad_medium',
      個人情報取得ポイント: 'info_acquired_points',
      顧客情報取得日: 'info_acquired_date',
      メルマガ登録日時: 'mailmag_registered_at',
      登録日: 'registered_at',
      初回接触日: 'first_contact_date',
      生年月日: 'birthdate',
      性別: 'gender',
      紹介者氏名: 'referrer_name',
      ｱﾌｨﾘID: 'affiliate_id',
      アフィリ名: 'affiliate_name',
    },
  },

  // ----- inquiries (kawara_scv + kimitsucp_csv) -----
  // 共通カラムのみマップ。残りは extra に格納されるはず
  {
    objectId: 'inquiries',
    csvFile: 'kawara_scv.csv',
    mapping: {
      問合せID: 'id',
      会員ID: 'member_id',
      フォーム名: 'form_id', // 実際は form 名 → form_id 解決
      広告ID: 'ad_id',
      氏名: 'name',
      氏名かな: 'name_kana',
      郵便番号: 'postal_code',
      住所: 'address',
      メールアドレス: 'email',
      電話番号: 'phone',
      登録日時: 'registered_at',
    },
  },
  // 機密保持・CP も inquiries テーブルに統合される
  {
    objectId: 'inquiries',
    csvFile: 'kimitsucp_csv.csv',
    mapping: {
      問合せID: 'id',
      フォーム名: 'form_id',
      会員ID: 'member_id',
      氏名: 'name',
      氏名かな: 'name_kana',
      郵便番号: 'postal_code',
      住所: 'address',
      メールアドレス: 'email',
      電話番号: 'phone',
      登録日時: 'registered_at',
      // 機密保持・CP 独自のフィールドは extra 行き
    },
  },

  // ----- applications (moushikomi_csv) -----
  {
    objectId: 'applications',
    csvFile: 'moushikomi_csv.csv',
    mapping: {
      投資案件: 'project_id',
      申込情報ID: 'id',
      問合せ管理ID: 'inquiry_id',
      申込日: 'application_date',
      ｽﾃｰﾀｽ: 'status',
      '入金/移動': 'flow_type',
      会員ID: 'member_id',
      永久担当: 'owner_name_raw',
      申込獲得者: 'acquirer_name_raw',
      契約書送付日: 'contract_sent_date',
      起算月: 'start_month',
      入金予定日: 'scheduled_payment_date',
      入金予定額: 'scheduled_amount',
      入金日: 'payment_date',
      入金額: 'payment_amount',
      仮想通貨除外分: 'crypto_excluded_amount',
      円金利: 'yen_interest',
      資金移動日: 'transfer_date',
      資金移動額: 'transfer_amount',
      資金移動先: 'transfer_to',
      出金額: 'withdrawal_amount',
      出金日: 'withdrawal_date',
      契約期間: 'contract_period',
      起算日時: 'start_datetime',
    },
  },
];

/** CSV ヘッダーから推定するデータ型 */
function inferDataType(csvCol: string): string {
  if (/額$|金$|数$|枚$|率$|金利$|料率$|ﾚｰﾄ$|レート$|ﾎﾟｲﾝﾄ$|ポイント$/.test(csvCol)) {
    return 'number';
  }
  if (/日$/.test(csvCol)) return 'date';
  if (/日時$/.test(csvCol)) return 'datetime';
  if (/フラグ$/.test(csvCol)) return 'boolean';
  return 'text';
}

async function main(): Promise<void> {
  const args = parseArgs();
  const supabase = createMigrateClient();

  logger.info('Phase 1.5: CSV カラムを field_definitions に同期', { dryRun: args.dryRun });

  // オブジェクトごとに既存の最大 extra 連番を取得 (UPSERT で連番衝突しないように)
  for (const target of TARGETS) {
    const csvPath = resolve(process.cwd(), 'csv', target.csvFile);
    if (!existsSync(csvPath)) {
      logger.warn(`CSV が見つかりません (スキップ): ${csvPath}`);
      continue;
    }

    logger.info(`--- ${target.objectId} (${target.csvFile}) ---`);

    const headers = readCsvHeaders(csvPath);
    logger.info(`  CSV ヘッダー: ${headers.length}列`);

    // 既存 field_definitions を取得
    const { data: existing, error: exErr } = await supabase
      .from('field_definitions')
      .select('id, field_name, csv_column_name, sort_order_list, is_in_db')
      .eq('object_id', target.objectId);
    if (exErr) {
      logger.error(`既存取得失敗: ${exErr.message}`);
      process.exit(1);
    }
    const existingMap = new Map<string, { field_name: string; sort_order_list: number }>();
    for (const row of existing ?? []) {
      if (row.csv_column_name) existingMap.set(row.csv_column_name, row);
      // DB物理列でマッピング先と一致するもの (csv_column_name=null だが field_name=対応)
      existingMap.set(row.field_name, row);
    }
    const existingFieldNames = new Set((existing ?? []).map((r) => r.field_name));

    // 最大の extra 連番を取得
    let extraCounter = 1;
    for (const row of existing ?? []) {
      const m = row.field_name.match(/^extra_(\d+)$/);
      if (m) {
        const n = Number.parseInt(m[1]!, 10);
        if (n >= extraCounter) extraCounter = n + 1;
      }
    }

    // 最大の sort_order_list を取得
    let maxSort = 100;
    for (const row of existing ?? []) {
      if (row.sort_order_list > maxSort) maxSort = row.sort_order_list;
    }

    // 各 CSV ヘッダーを処理
    const toInsert: Record<string, unknown>[] = [];
    const toUpdate: { id: number; csv_column_name: string }[] = [];
    let skipped = 0;

    for (const header of headers) {
      const trimmed = header.trim();
      if (!trimmed) continue;

      const mappedDbCol = target.mapping[trimmed];

      if (mappedDbCol) {
        // DB 物理カラムマッピングあり: 既存 field_name=mappedDbCol を csv_column_name で更新
        const existRow = existingMap.get(mappedDbCol);
        if (existRow) {
          // csv_column_name が空ならセット
          toUpdate.push({ id: (existRow as { id: number }).id, csv_column_name: trimmed });
        }
        // 既存になければ INSERT (System側に登録漏れ)
        else {
          maxSort += 10;
          toInsert.push({
            object_id: target.objectId,
            field_name: mappedDbCol,
            label: trimmed,
            data_type: inferDataType(trimmed),
            is_visible_list: false,
            is_visible_detail: true,
            is_system: true,
            is_custom: false,
            is_in_db: true,
            csv_column_name: trimmed,
            sort_order_list: maxSort,
            sort_order_detail: maxSort,
          });
        }
      } else {
        // マッピングなし → extra 連番で新規登録
        const alreadyExists = existingMap.has(trimmed);
        if (alreadyExists) {
          skipped++;
          continue;
        }
        const fieldName = `extra_${String(extraCounter).padStart(3, '0')}`;
        extraCounter++;
        maxSort += 10;
        if (existingFieldNames.has(fieldName)) {
          // 万一の衝突回避
          continue;
        }
        existingFieldNames.add(fieldName);
        toInsert.push({
          object_id: target.objectId,
          field_name: fieldName,
          label: trimmed,
          data_type: inferDataType(trimmed),
          is_visible_list: false,
          is_visible_detail: true,
          is_system: false,
          is_custom: false, // Phase 1.5 で自動追加されたものは custom 扱いではなく非システム
          is_in_db: false,
          csv_column_name: trimmed,
          sort_order_list: maxSort,
          sort_order_detail: maxSort,
        });
      }
    }

    logger.info(
      `  処理結果: INSERT ${toInsert.length}件 / UPDATE ${toUpdate.length}件 / SKIP ${skipped}件`,
    );

    if (args.dryRun) {
      logger.info('  --dry-run: DB 投入はスキップ');
      for (const r of toInsert.slice(0, 5)) {
        logger.info(`    INSERT: ${JSON.stringify(r)}`);
      }
      continue;
    }

    // INSERT
    if (toInsert.length > 0) {
      const { error } = await supabase.from('field_definitions').insert(toInsert);
      if (error) {
        logger.error(`INSERT 失敗 (${target.objectId}): ${error.message}`);
        continue;
      }
    }
    // UPDATE (csv_column_name のみ更新)
    for (const upd of toUpdate) {
      const { error } = await supabase
        .from('field_definitions')
        .update({ csv_column_name: upd.csv_column_name })
        .eq('id', upd.id);
      if (error) {
        logger.error(`UPDATE 失敗 id=${upd.id}: ${error.message}`);
      }
    }
  }

  logger.info('=== 完了 ===');

  // 集計表示
  if (!args.dryRun) {
    for (const target of TARGETS) {
      const { count } = await supabase
        .from('field_definitions')
        .select('id', { count: 'exact', head: true })
        .eq('object_id', target.objectId);
      logger.info(`  ${target.objectId}: ${count} フィールド`);
    }
  }
}

main().catch((e) => {
  logger.error('予期せぬエラー', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
