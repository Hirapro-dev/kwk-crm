/**
 * 期間プリセット ユーティリティ。
 *
 * 案件一覧の期間フィルター用。
 * すべて Asia/Tokyo タイムゾーン前提(社内システムのため簡略化)。
 */

export type DatePresetKey =
  | 'all'
  | 'today'
  | 'yesterday'
  | 'this_month'
  | 'last_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'last_12_months'
  | 'this_year'
  | 'last_year'
  | 'custom';

export const DATE_PRESET_LABELS: Record<DatePresetKey, string> = {
  all: '累計',
  today: '今日',
  yesterday: '昨日',
  this_month: '今月',
  last_month: '先月',
  last_3_months: '過去3ヶ月',
  last_6_months: '過去6ヶ月',
  last_12_months: '過去12ヶ月',
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
// 日付の計算はすべて UTC の暦で行う(下の resolveDateRange が日本時間に 9 時間ずらした時刻を渡す)
function fmt(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 年・月(0 始まり)・日から日付を作る(月・日のはみ出しは繰り上げ・繰り下げ) */
function ymd(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * プリセットキーから日付範囲を計算する。
 * custom の場合は customFrom / customTo をそのまま返す。
 */
export function resolveDateRange(
  preset: DatePresetKey,
  customFrom?: string | null,
  customTo?: string | null,
  base: Date = new Date(),
): DateRange {
  // サーバー(Vercel)の時計は UTC。日本時間の暦で「今日・今月」を決めるため 9 時間進めて UTC の暦で読む
  // (サーバーのローカル時刻で計算していたため、日本時間 0:00〜8:59 は前日・前月になっていた)
  const now = new Date(base.getTime() + JST_OFFSET_MS);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  switch (preset) {
    case 'all':
      return { from: null, to: null };
    case 'today': {
      const t = fmt(now);
      return { from: t, to: t };
    }
    case 'yesterday': {
      const yd = fmt(ymd(y, m, now.getUTCDate() - 1));
      return { from: yd, to: yd };
    }
    case 'this_month':
      return {
        from: fmt(ymd(y, m, 1)),
        to: fmt(ymd(y, m + 1, 0)),
      };
    case 'last_month':
      return {
        from: fmt(ymd(y, m - 1, 1)),
        to: fmt(ymd(y, m, 0)),
      };
    case 'last_3_months':
      // 当月含む直近3ヶ月(月初〜当月末)
      return {
        from: fmt(ymd(y, m - 2, 1)),
        to: fmt(ymd(y, m + 1, 0)),
      };
    case 'last_6_months':
      return {
        from: fmt(ymd(y, m - 5, 1)),
        to: fmt(ymd(y, m + 1, 0)),
      };
    case 'last_12_months':
      return {
        from: fmt(ymd(y, m - 11, 1)),
        to: fmt(ymd(y, m + 1, 0)),
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
    'yesterday',
    'this_month',
    'last_month',
    'last_3_months',
    'last_6_months',
    'last_12_months',
    'this_year',
    'last_year',
    'custom',
  ];
  if (value && (valid as string[]).includes(value)) {
    return value as DatePresetKey;
  }
  return 'all';
}
