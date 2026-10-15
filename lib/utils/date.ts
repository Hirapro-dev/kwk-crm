/**
 * 仕様書 §12.1 に従い、日付表示は `YYYY/MM/DD HH:mm` (日本ロケール) で統一する。
 *
 * date-fns の format() はサーバー(Vercel = UTC)のローカルタイムゾーンで動作するため、
 * すべて Intl.DateTimeFormat に timeZone: 'Asia/Tokyo' を明示し、
 * サーバー・クライアントいずれでも JST 表示を保証する。
 */

const JST_TZ = 'Asia/Tokyo';

function toParts(d: Date, options: Intl.DateTimeFormatOptions): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat('ja-JP', { timeZone: JST_TZ, ...options })
      .formatToParts(d)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  );
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const p = toParts(d, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  if (p.hour === '00' && p.minute === '00') {
    return `${p.year}/${p.month}/${p.day}`;
  }
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const p = toParts(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}/${p.month}/${p.day}`;
}

export function formatMonth(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const p = toParts(d, { year: 'numeric', month: '2-digit' });
  return `${p.year}/${p.month}`;
}

// ---------------------------------------------------------------------------
// 日本時間の境目・入力値の変換(サーバー = UTC でも日本時間で扱うための純粋関数)
// 日本は夏時間が無いため、UTC との差は常に +9 時間で固定。
// ---------------------------------------------------------------------------

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 日本時間の年・月(0 始まり)・日。実行環境の時刻帯に依存しない */
function jstCalendar(now: Date): { y: number; m: number; d: number } {
  const j = new Date(now.getTime() + JST_OFFSET_MS);
  return { y: j.getUTCFullYear(), m: j.getUTCMonth(), d: j.getUTCDate() };
}

/** 日本時間の y/m/d 0:00 の UTC ISO(月・日のはみ出しは Date.UTC が繰り上げる) */
function jstMidnightIso(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m, d) - JST_OFFSET_MS).toISOString();
}

/** 日本時間の「今日」0:00 を UTC の ISO 文字列で返す(ダッシュボードの今日の起点) */
export function jstDayStartIso(now: Date = new Date()): string {
  const { y, m, d } = jstCalendar(now);
  return jstMidnightIso(y, m, d);
}

/** 日本時間の「今月」1 日 0:00 を UTC の ISO 文字列で返す */
export function jstMonthStartIso(now: Date = new Date()): string {
  const { y, m } = jstCalendar(now);
  return jstMidnightIso(y, m, 1);
}

/**
 * 日本時間の「今月」を日付(YYYY-MM-DD)の範囲で返す。from は 1 日、toExclusive は翌月 1 日。
 * date 型の列(入金日など)の絞り込み用。
 */
export function jstMonthRangeYmd(now: Date = new Date()): { from: string; toExclusive: string } {
  const { y, m } = jstCalendar(now);
  const next = new Date(Date.UTC(y, m + 1, 1));
  return {
    from: `${y}-${pad2(m + 1)}-01`,
    toExclusive: `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-01`,
  };
}

/**
 * 日本時間の日付の範囲(YYYY-MM-DD。両端を含む)を、timestamptz と比べる UTC ISO の範囲に変える。
 * from はその日の 0:00、to はその日の 23:59:59.999(日本時間)。空・不正な日付は undefined。
 */
export function jstDateRangeToIso(
  from?: string | null,
  to?: string | null,
): { from?: string; to?: string } {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/;
  const out: { from?: string; to?: string } = {};
  const f = from ? ymd.exec(from) : null;
  if (f) out.from = jstMidnightIso(Number(f[1]), Number(f[2]) - 1, Number(f[3]));
  const t = to ? ymd.exec(to) : null;
  if (t) {
    const nextDay = Date.parse(jstMidnightIso(Number(t[1]), Number(t[2]) - 1, Number(t[3]) + 1));
    out.to = new Date(nextDay - 1).toISOString();
  }
  return out;
}

/**
 * DB の日時(ISO / timestamptz の文字列)を input[type=datetime-local] 用の
 * 日本時間 `YYYY-MM-DDTHH:mm` に変換する。空・不正は ''。
 */
export function toJstDateTimeLocal(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 16);
}

/**
 * 画面で入力された日時を UTC の ISO 文字列に変換する。
 * - 時差の表記が無いもの(datetime-local の `YYYY-MM-DDTHH:mm[:ss]`、`YYYY-MM-DD HH:mm`、
 *   日付だけの `YYYY-MM-DD`)は日本時間として解釈する
 * - `Z` や `+09:00` などの時差付きはそのまま解釈する
 * - 空は null、解釈できないものは undefined(呼び出し側でエラーにする)
 */
export function jstInputToIso(value: string | null | undefined): string | null | undefined {
  const s = (value ?? '').trim();
  if (!s) return null;
  const local = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(:\d{2}(?:\.\d+)?)?)?$/.exec(s);
  const iso = local
    ? `${local[1]}T${local[2] ?? '00:00'}${local[3] ?? ':00'}+09:00`
    : /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)
      ? s
      : null;
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** 日時を日本時間の `YYYY/MM/DD HH:mm` で返す(時刻が 0:00 でも省略しない。CSV 出力用)。不正は '' */
export function formatJstDateTimeHm(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return `${j.getUTCFullYear()}/${pad2(j.getUTCMonth() + 1)}/${pad2(j.getUTCDate())} ${pad2(j.getUTCHours())}:${pad2(j.getUTCMinutes())}`;
}

/**
 * 日時を Excel のシリアル値(1900 年起点の日数)にする。値は日本時間の壁時計。
 * xlsx ライブラリに Date を渡すと実行環境の時刻帯(Vercel = UTC)で書かれるため、数値で渡す。
 */
export function toJstExcelSerial(date: Date | string): number | null {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  // 25569 = 1970-01-01 のシリアル値
  return (d.getTime() + JST_OFFSET_MS) / 86_400_000 + 25569;
}
