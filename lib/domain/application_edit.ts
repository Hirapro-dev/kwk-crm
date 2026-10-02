/**
 * 申込詳細の編集(CLAUDE.md §8.1 `/applications/[id]`。admin のみ。2026-10-01)の純粋関数。
 * 画面の入力(すべて文字列)を、DB 列のホワイトリストと型に従って更新内容に変換する。サーバー依存なし。
 */

import { normalizeContractPeriod, startDateToTimestamp } from './application_create_schema';
import { ALL_APP_STATUSES, INTEREST_TYPES } from './applications_constants';

type ColType =
  | 'text'
  | 'months'
  | 'status'
  | 'interestType'
  | 'ref'
  | 'date'
  | 'jstDate'
  | 'number';

/** 編集できる DB 列と型。id / inquiry_id / 取込時の原文(*_name_raw)/ extra は含めない(extra は別扱い) */
export const EDITABLE_APPLICATION_COLUMNS: Readonly<Record<string, ColType>> = {
  project_id: 'ref',
  member_id: 'ref',
  owner_id: 'ref',
  acquirer_id: 'ref',
  status: 'status',
  application_date: 'date',
  contract_sent_date: 'date',
  scheduled_payment_date: 'date',
  payment_date: 'date',
  withdrawal_date: 'date',
  transfer_date: 'date',
  contract_end_date: 'date',
  // 起算日(2026-10-02 に時刻の入力をやめた。新規登録と同じく日本時間のその日の 0 時で保存)
  start_datetime: 'jstDate',
  scheduled_amount: 'number',
  payment_amount: 'number',
  crypto_excluded_amount: 'number',
  yen_interest: 'number',
  interest_type: 'interestType',
  interest: 'number',
  withdrawal_amount: 'number',
  transfer_amount: 'number',
  campaign_target_amount: 'number',
  start_month: 'text',
  contract_period: 'months',
  transfer_to: 'text',
  transfer_from: 'text',
};

/** UTC の ISO 文字列 → 画面の datetime-local 用(日本時間の "YYYY-MM-DDTHH:mm") */
export function toJstDateTimeLocal(v: unknown): string {
  if (!v) return '';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16);
}

/**
 * 画面の入力を更新内容にする。ホワイトリスト外の列は無視する。
 * - 空文字は null(ただし案件・会員・ステータスは必須)
 * - 数値はカンマ・空白を除いて数値にする / 日付は YYYY-MM-DD / 起算日は日本時間のその日の 0 時を UTC の ISO に
 * - ステータス・利息種別は選択肢の値だけ
 */
export function buildApplicationPatch(
  form: Record<string, string | null | undefined>,
): { patch: Record<string, string | number | null> } | { error: string } {
  const patch: Record<string, string | number | null> = {};
  for (const [key, raw] of Object.entries(form)) {
    const type = EDITABLE_APPLICATION_COLUMNS[key];
    if (!type) continue;
    const v = (raw ?? '').trim();
    if (v === '') {
      if (key === 'project_id') return { error: '案件は必須です' };
      if (key === 'member_id') return { error: '会員は必須です' };
      if (key === 'status') return { error: 'ステータスは必須です' };
      patch[key] = null;
      continue;
    }
    switch (type) {
      case 'status':
        // 過去の値(完了・未購入・失効)の申込を、ステータスを変えずに保存できるよう全値で検証する。
        // 画面の選択肢は今の値 + 新しい選択肢だけ(ApplicationEditDialog)
        if (!(ALL_APP_STATUSES as string[]).includes(v))
          return { error: `ステータスが不正です: ${v}` };
        patch[key] = v;
        break;
      case 'interestType':
        if (!(INTEREST_TYPES as string[]).includes(v)) return { error: `利息種別が不正です: ${v}` };
        patch[key] = v;
        break;
      case 'months': {
        const n = normalizeContractPeriod(v);
        if (!n) return { error: `契約期間は月数(数字)で入力してください(${v})` };
        patch[key] = n;
        break;
      }
      case 'number': {
        const n = Number(v.replace(/[,\s]/g, ''));
        if (!Number.isFinite(n)) return { error: `数値を入力してください(${v})` };
        patch[key] = n;
        break;
      }
      case 'date': {
        const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))
          return { error: `日付の形式が不正です(${v})` };
        patch[key] = v;
        break;
      }
      case 'jstDate': {
        const ts = /^\d{4}-\d{2}-\d{2}$/.test(v) ? startDateToTimestamp(v) : null;
        if (!ts) return { error: `日付の形式が不正です(${v})` };
        patch[key] = ts;
        break;
      }
      default:
        patch[key] = v.slice(0, 500);
    }
  }
  return { patch };
}
