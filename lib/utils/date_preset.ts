/**
 * 期間プリセット ユーティリティ。
 *
 * 案件一覧の期間フィルター用。
 * すべて Asia/Tokyo タイムゾーン前提(社内システムのため簡略化)。
 */

export type DatePresetKey =
  | 'all'
  | 'today'
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'last_year'
  | 'custom';

export const DATE_PRESET_LABELS: Record<DatePresetKey, string> = {
  all: '累計',
  today: '今日',
  this_month: '今月',
  last_month: '先月',
  this_year: '今年',
  last_year: '昨年',
  custom: '期間指定',
};

export interface DateRange {
  /** YYYY-MM-DD 形式の開始日(inclusive)。null=制限なし */
  from: string | null;
  /** YYYY-MM-DD 形式の終了日(inclusive)。null=制限なし */
  to: string | null;
}

/** YYYY-MM-DD で日付フォーマット */
function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * プリセットキーから日付範囲を計算する。
 * custom の場合は customFrom / customTo をそのまま返す。
 */
export function resolveDateRange(
  preset: DatePresetKey,
  customFrom?: string | null,
  customTo?: string | null,
): DateRange {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (preset) {
    case 'all':
      return { from: null, to: null };
    case 'today': {
      const t = fmt(now);
      return { from: t, to: t };
    }
    case 'this_month':
      return {
        from: fmt(new Date(y, m, 1)),
        to: fmt(new Date(y, m + 1, 0)),
      };
    case 'last_month':
      return {
        from: fmt(new Date(y, m - 1, 1)),
        to: fmt(new Date(y, m, 0)),
      };
    case 'this_year':
      return {
        from: `${y}-01-01`,
        to: `${y}-12-31`,
      };
    case 'last_year':
      return {
        from: `${y - 1}-01-01`,
        to: `${y - 1}-12-31`,
      };
    case 'custom':
      return {
        from: customFrom || null,
        to: customTo || null,
      };
  }
}

/** URL クエリの preset 値が有効かどうかチェック。不正なら 'all' にフォールバック */
export function normalizePreset(value: string | undefined): DatePresetKey {
  const valid: DatePresetKey[] = [
    'all',
    'today',
    'this_month',
    'last_month',
    'this_year',
    'last_year',
    'custom',
  ];
  if (value && (valid as string[]).includes(value)) {
    return value as DatePresetKey;
  }
  return 'all';
}
