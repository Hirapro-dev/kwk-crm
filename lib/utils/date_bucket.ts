/**
 * 日付を「表示粒度」ごとのバケットに分類する純粋ユーティリティ。
 * サマリ画面で 日別/週別/月別/四半期別/2期(半期)別/年別 の集計に使う。
 *
 * 入力は 'YYYY-MM-DD'(JST 前提のローカル日付) を想定。
 */

export type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'half' | 'year';

export const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: '日別',
  week: '週別',
  month: '月別',
  quarter: '四半期別',
  half: '2期別',
  year: '年別',
};

export function normalizeGranularity(v: string | undefined): Granularity {
  const valid: Granularity[] = ['day', 'week', 'month', 'quarter', 'half', 'year'];
  return v && (valid as string[]).includes(v) ? (v as Granularity) : 'month';
}

export interface Bucket {
  /** ソート/集約に使う安定キー */
  key: string;
  /** 画面表示用ラベル */
  label: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO/タイムスタンプ文字列を JST の YYYY-MM-DD に変換する */
export function isoToJstYmd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}`;
}

/** YYYY-MM-DD をローカル年月日に分解 */
function parseYmd(dateStr: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateStr
    .slice(0, 10)
    .split('-')
    .map((s) => Number.parseInt(s, 10));
  return { y: y ?? 0, m: m ?? 1, d: d ?? 1 };
}

/** ISO週(月曜始まり)の月曜日を返す */
function mondayOf(y: number, m: number, d: number): Date {
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=日
  const diff = dow === 0 ? -6 : 1 - dow; // 月曜まで戻す
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt;
}

/** 日付文字列を指定粒度のバケットに変換する */
export function bucketOf(dateStr: string, g: Granularity): Bucket {
  const { y, m, d } = parseYmd(dateStr);

  switch (g) {
    case 'day':
      return { key: `${y}-${pad(m)}-${pad(d)}`, label: `${y}/${pad(m)}/${pad(d)}` };
    case 'week': {
      const mon = mondayOf(y, m, d);
      const wy = mon.getUTCFullYear();
      const wm = mon.getUTCMonth() + 1;
      const wd = mon.getUTCDate();
      const key = `${wy}-${pad(wm)}-${pad(wd)}`;
      return { key, label: `${wy}/${pad(wm)}/${pad(wd)}週` };
    }
    case 'month':
      return { key: `${y}-${pad(m)}`, label: `${y}/${pad(m)}` };
    case 'quarter': {
      const q = Math.floor((m - 1) / 3) + 1;
      return { key: `${y}-Q${q}`, label: `${y} Q${q}` };
    }
    case 'half': {
      const h = m <= 6 ? 1 : 2;
      return { key: `${y}-H${h}`, label: `${y} ${h === 1 ? '上期' : '下期'}` };
    }
    case 'year':
      return { key: `${y}`, label: `${y}` };
  }
}
