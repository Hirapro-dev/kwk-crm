/**
 * 取込の「新規 / 更新 / スキップ」分類ロジック (Issue1)
 *
 * 方針(安全側):
 *   - 既存IDが無い → 新規
 *   - 既存IDがあり、取込レコードが書き込む列が既存行と「完全一致」→ スキップ(上書きしない)
 *   - 既存IDがあり、少しでも差分がある → 更新
 *   ※ 判定を誤っても「不要な上書き(更新)」になるだけでデータは壊れない。
 *     本当に変わった行を取りこぼさないよう、少しでも違えば必ず更新する。
 *
 * 値の比較は canonForCompare で正規化してから行う:
 *   - null / undefined / 空文字 は同一視
 *   - 数値は 1000 と 1000.00 を同一視
 *   - 日付/日時は表現差(書式・タイムゾーン表記)を吸収してエポックで比較
 *   - JSONB(extra) はキー順に依存しない安定文字列で比較
 */

// biome-ignore lint/suspicious/noExplicitAny: Tables 型が空のため supabase クライアントは緩い型
type Db = any;

/** JSONB 等を キー順に依存しない安定文字列にする */
function stableJson(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(',')}}`;
}

/** 比較用の正規化文字列を返す(表現差を吸収する) */
export function canonForCompare(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'object') return stableJson(v);
  const s = String(v).trim();
  if (s === '') return '';
  // 日付/日時(YYYY-MM-DD / YYYY/MM/DD, 時刻付きも可): エポックで比較して書式差を吸収
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?/.test(s)) {
    const t = Date.parse(s.replace(/\//g, '-'));
    if (Number.isFinite(t)) return `@${t}`;
  }
  // 数値: 1000 と 1000.00 を同一視
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return String(n);
  }
  return s;
}

/**
 * 取込レコード data が既存行 ex と(data が書き込む列について)完全一致なら true。
 * true のとき「変更なし=スキップ」対象。少しでも差があれば false(=更新)。
 */
export function isUnchanged(data: Record<string, unknown>, ex: Record<string, unknown>): boolean {
  for (const key of Object.keys(data)) {
    if (key === 'id') continue; // 主キーは比較不要
    if (canonForCompare(data[key]) !== canonForCompare(ex[key])) return false;
  }
  return true;
}

export interface Classification<T> {
  /** 実際に upsert する対象(新規 + 更新) */
  toUpsert: T[];
  newCount: number;
  updateCount: number;
  /** スキップ件数(変更なし + updateOnly時の新規除外) */
  skippedCount: number;
  /** 既存(DBに存在する)ID集合。プレビューの行別モード表示等に使う */
  existingIds: Set<string>;
}

/** id 群のうち既存行を id→行 のマップで返す(全列取得して差分比較に使う) */
export async function loadExistingRows(
  supabase: Db,
  table: string,
  idField: string,
  ids: string[],
  batch = 500,
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += batch) {
    const chunk = ids.slice(i, i + batch);
    if (chunk.length === 0) continue;
    const { data } = await supabase.from(table).select('*').in(idField, chunk);
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const idv = r[idField];
      if (idv != null) map.set(String(idv), r);
    }
  }
  return map;
}

/** records を 既存行マップと突合して 新規/更新/スキップ に分類する */
export function classifyRecords<T>(
  records: T[],
  getId: (r: T) => string,
  existingRows: Map<string, Record<string, unknown>>,
  opts?: { updateOnly?: boolean; getData?: (r: T) => Record<string, unknown> },
): Classification<T> {
  const toUpsert: T[] = [];
  const existingIds = new Set<string>();
  let newCount = 0;
  let updateCount = 0;
  let skippedCount = 0;
  for (const r of records) {
    const id = getId(r);
    const ex = existingRows.get(id);
    const data = opts?.getData ? opts.getData(r) : (r as unknown as Record<string, unknown>);
    if (!ex) {
      if (opts?.updateOnly) {
        skippedCount++; // 更新のみモード: 新規IDはスキップ
        continue;
      }
      newCount++;
      toUpsert.push(r);
    } else {
      existingIds.add(id);
      if (isUnchanged(data, ex)) {
        skippedCount++; // 変更なし
      } else {
        updateCount++;
        toUpsert.push(r);
      }
    }
  }
  return { toUpsert, newCount, updateCount, skippedCount, existingIds };
}

/** id 群の既存行を取得して分類まで一括で行う */
export async function classifyAgainstDb<T>(
  supabase: Db,
  table: string,
  idField: string,
  records: T[],
  getId: (r: T) => string,
  opts?: { updateOnly?: boolean; getData?: (r: T) => Record<string, unknown> },
): Promise<Classification<T>> {
  const ids = records.map(getId);
  const existing = await loadExistingRows(supabase, table, idField, ids);
  return classifyRecords(records, getId, existing, opts);
}
