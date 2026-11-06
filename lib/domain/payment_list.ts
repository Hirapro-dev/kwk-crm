/**
 * サマリの入金一覧(CLAUDE.md §8.1 `/summary` の入金タブ)の絞り込みとリンク。純粋関数。
 *
 * 一覧は「担当者別の合計に数えている申込」と同じものを出す(合計と一覧の件数が食い違わないように):
 *   入金額が 0 より大きい / 入金日が期間内 / 案件 / 申込獲得者が集計の表に出ている担当者(有効・無効の絞り込みに従う)。
 * ユーザー名を押したときは、その人の入金だけに絞る(`?user=`)。
 */

import { normalizePreset, resolveDateRange } from '@/lib/utils/date_preset';
import { parseProjectFilterParam } from './application_list_filter';
import type { ApplicationListField } from './applications_csv';

/**
 * 入金一覧の列(画面と CSV で共通。2026-11-06 ユーザー指定)。項目管理の表示設定の影響を受けない固定の列。
 * 並び替えは APPLICATION_SORTABLE にある列だけ付ける(無い列の見出しを押しても並びが変わらないため)。
 */
export const PAYMENT_LIST_FIELDS: readonly ApplicationListField[] = [
  column(1, 'project_id', '案件', { sortField: 'project_id' }),
  column(2, 'acquirer_id', '申込獲得者'),
  column(3, 'member_code', '会員ID', { sortField: 'member_id' }),
  column(4, 'member_name', '会員氏名'),
  column(5, 'payment_date', '入金日', { dataType: 'date', sortField: 'payment_date' }),
  column(6, 'payment_amount', '入金額', { dataType: 'number', sortField: 'payment_amount' }),
  column(7, 'contract_period', '契約期間'),
  // 備考は可変項目(extra)。項目管理の定義は migration 120
  column(8, '備考', '備考', { isInDb: false }),
];

function column(
  id: number,
  fieldName: string,
  label: string,
  opts: {
    dataType?: ApplicationListField['data_type'];
    sortField?: string;
    isInDb?: boolean;
  } = {},
): ApplicationListField {
  return {
    id,
    field_name: fieldName,
    label,
    data_type: opts.dataType ?? 'text',
    is_in_db: opts.isInDb ?? true,
    csv_column_name: null,
    sortField: opts.sortField ?? null,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PaymentListFilter {
  /** 入金日の開始(YYYY-MM-DD)。null = 制限なし */
  paymentFrom: string | null;
  /** 入金日の終了(YYYY-MM-DD)。null = 制限なし */
  paymentTo: string | null;
  /** 案件ID(T-…)。null = 全案件 */
  projectId: string | null;
}

export interface PaymentListParams {
  paymentOnly: true;
  paymentFrom?: string;
  paymentTo?: string;
  projectId?: string;
  /** 申込獲得者の ID(空なら 0 件) */
  acquirerIds: string[];
  /** 絞り込んでいるユーザー(集計の表に出ている人だけ有効)。null = 全員 */
  selectedUserId: string | null;
}

/** 集計の表に出ている担当者(rowUserIds)と、選んだユーザーから一覧の絞り込みを決める */
export function paymentListParams(
  filter: PaymentListFilter,
  rowUserIds: readonly string[],
  selectedUser?: string | null,
): PaymentListParams {
  const selected =
    selectedUser && UUID_RE.test(selectedUser) && rowUserIds.includes(selectedUser)
      ? selectedUser
      : null;
  return {
    paymentOnly: true,
    paymentFrom: filter.paymentFrom ?? undefined,
    paymentTo: filter.paymentTo ?? undefined,
    projectId: filter.projectId ?? undefined,
    acquirerIds: selected ? [selected] : [...rowUserIds],
    selectedUserId: selected,
  };
}

/** 画面の絞り込みとして引き継ぐクエリ(タブ・続き読みの位置は含めない) */
const CARRY_KEYS = ['preset', 'from', 'to', 'project', 'active', 'user', 'sort', 'dir'] as const;

function carried(sp: Readonly<Record<string, string | undefined>>): URLSearchParams {
  const q = new URLSearchParams();
  for (const k of CARRY_KEYS) {
    const v = sp[k];
    if (v) q.set(k, v);
  }
  return q;
}

/**
 * 担当者別の表のユーザー名に付けるリンク。今の絞り込みを残してそのユーザーで絞る。
 * 選択中のユーザーをもう一度押したとき・null のときは解除する。
 */
export function summaryUserHref(
  sp: Readonly<Record<string, string | undefined>>,
  userId: string | null,
): string {
  const q = carried(sp);
  if (userId && sp.user !== userId) q.set('user', userId);
  else q.delete('user');
  const s = q.toString();
  return s ? `/summary?${s}` : '/summary';
}

/** 入金一覧の CSV 出力のリンク(画面と同じ絞り込み・並び) */
export function paymentExportHref(sp: Readonly<Record<string, string | undefined>>): string {
  const s = carried(sp).toString();
  return s ? `/summary/payment/export?${s}` : '/summary/payment/export';
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 申込獲得者の上限(担当者別の表の人数より十分大きい) */
const MAX_ACQUIRER_IDS = 500;

/**
 * 画面(続き読み)から届いた入金一覧の絞り込みを検証し直す(Server Action は任意の値を受け取れるため)。
 * 日付は YYYY-MM-DD だけ、申込獲得者は UUID だけを残す。paymentOnly でなければ入金の絞り込みは付けない。
 */
export function sanitizePaymentFilter(input: {
  paymentOnly?: unknown;
  paymentFrom?: unknown;
  paymentTo?: unknown;
  acquirerIds?: unknown;
}): {
  paymentOnly?: true;
  paymentFrom?: string;
  paymentTo?: string;
  acquirerIds?: string[];
} {
  if (input.paymentOnly !== true) return {};
  const ymd = (v: unknown) => (typeof v === 'string' && YMD_RE.test(v) ? v : undefined);
  const ids = Array.isArray(input.acquirerIds)
    ? [
        ...new Set(
          input.acquirerIds.filter((v): v is string => typeof v === 'string' && UUID_RE.test(v)),
        ),
      ]
    : [];
  return {
    paymentOnly: true,
    paymentFrom: ymd(input.paymentFrom),
    paymentTo: ymd(input.paymentTo),
    acquirerIds: ids.slice(0, MAX_ACQUIRER_IDS),
  };
}

/**
 * サマリの入金タブの絞り込み(期間・案件・ユーザーの有効/無効)を URL クエリから読む。
 * 画面(page.tsx)と CSV 出力(/summary/payment/export)で同じ解釈にするため 1 か所にまとめる。
 * 期間の既定は今月。
 */
export function resolvePaymentSummaryFilter(sp: Readonly<Record<string, string | undefined>>) {
  const preset = sp.preset ? normalizePreset(sp.preset) : 'this_month';
  const range = resolveDateRange(preset, sp.from ?? null, sp.to ?? null);
  const projectId = parseProjectFilterParam(sp.project);
  const rawActive = sp.active ?? 'all';
  const activeFilter: 'all' | 'active' | 'inactive' =
    rawActive === 'active' || rawActive === 'inactive' ? rawActive : 'all';
  return { preset, range, projectId, activeFilter };
}
