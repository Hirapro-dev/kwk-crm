/**
 * メーラーの送信メールの添付(CLAUDE.md §5.15「送信メールの添付」/ migration 128)の純粋関数。画面とサーバーの両方で使う。
 *
 * 2026-10-21 ユーザー決定:
 *   - 送れるのは PDF・JPG・PNG だけ(2026-10-23 に Word・Excel・PowerPoint を追加。新旧の形式。マクロ付きは送らない)。
 *     1 ファイル 10MB・10 ファイル・1 通の合計 15MB まで
 *     (送るときに約 1.3 倍に膨らむため、相手のサーバー(Gmail などは 25MB)で弾かれにくい大きさ)
 *   - 本文の欄に画像を落とす(貼り付ける)と、その位置に「[画像: 名前]」の目印を入れ、相手には本文のその位置に画像を出す
 *     (HTML メールの <img src="cid:…">)。目印を消した画像は送らない。PDF は本文に落としても通常の添付
 */

import { splitLinks, storageSafeName } from './task_pure';

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PPTX_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export type MailAttachmentType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | typeof DOCX_TYPE
  | typeof XLSX_TYPE
  | typeof PPTX_TYPE
  | 'application/msword'
  | 'application/vnd.ms-excel'
  | 'application/vnd.ms-powerpoint';

/** 送れる種類の説明(画面・エラーの文言) */
export const MAIL_ATTACHMENT_KINDS_LABEL = 'PDF・JPG・PNG・Word・Excel・PowerPoint';

export const MAIL_ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAIL_ATTACHMENT_MAX_TOTAL_BYTES = 15 * 1024 * 1024;
export const MAIL_ATTACHMENT_MAX_FILES = 10;
const EXT_TYPES: Record<string, MailAttachmentType> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  docx: DOCX_TYPE,
  xlsx: XLSX_TYPE,
  pptx: PPTX_TYPE,
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
};

/** ファイル選択の accept 属性 */
export const MAIL_ATTACHMENT_ACCEPT = Object.keys(EXT_TYPES)
  .map((e) => `.${e}`)
  .join(',');

/** 添付欄のアイコンに出す拡張子(例: PDF / XLSX)。拡張子が無ければ「FILE」 */
export function fileExtLabel(filename: string): string {
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(filename ?? '')?.[1];
  return ext ? ext.toUpperCase() : 'FILE';
}

export function isInlineImageType(t: string | null | undefined): boolean {
  return t === 'image/jpeg' || t === 'image/png';
}

/**
 * ファイル名と(ブラウザ・Storage が付けた)種類から、送れる種類を決める。送れないものは null。
 * 種類が空ならファイル名の拡張子で判断し、種類があれば拡張子と一致するときだけ認める(食い違いは弾く)。
 */
export function resolveAttachmentType(
  filename: string,
  mime: string | null | undefined,
): MailAttachmentType | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(filename ?? '')?.[1]?.toLowerCase() ?? '';
  const byExt = EXT_TYPES[ext] ?? null;
  if (!byExt) return null;
  const m = (mime ?? '').trim().toLowerCase();
  // 種類が付いていない・「不明」のときは拡張子で判断する(Office 文書でよくある)
  if (!m || m === 'application/octet-stream') return byExt;
  const normalized = m === 'image/jpg' || m === 'image/pjpeg' ? 'image/jpeg' : m;
  return normalized === byExt ? byExt : null;
}

const MB = 1024 * 1024;

/**
 * 追加しようとしたファイルを確かめる(画面用)。既にある分と合わせて、件数・合計の上限を超える分は弾く。
 * 弾いたものは理由を errors に入れる(ファイル名付き)。
 */
export function checkNewAttachments<T extends { name: string; size: number; type: string }>(
  current: ReadonlyArray<{ size: number }>,
  adding: readonly T[],
): { accepted: Array<T & { contentType: MailAttachmentType }>; errors: string[] } {
  const accepted: Array<T & { contentType: MailAttachmentType }> = [];
  const errors: string[] = [];
  let count = current.length;
  let total = current.reduce((s, a) => s + a.size, 0);
  for (const f of adding) {
    const contentType = resolveAttachmentType(f.name, f.type);
    if (!contentType) {
      errors.push(`${f.name}: ${MAIL_ATTACHMENT_KINDS_LABEL} 以外は添付できません`);
    } else if (f.size <= 0) {
      errors.push(`${f.name}: 空のファイルは添付できません`);
    } else if (f.size > MAIL_ATTACHMENT_MAX_FILE_BYTES) {
      errors.push(`${f.name}: 1 ファイル ${MAIL_ATTACHMENT_MAX_FILE_BYTES / MB}MB までです`);
    } else if (count + 1 > MAIL_ATTACHMENT_MAX_FILES) {
      errors.push(`${f.name}: 添付は ${MAIL_ATTACHMENT_MAX_FILES} ファイルまでです`);
    } else if (total + f.size > MAIL_ATTACHMENT_MAX_TOTAL_BYTES) {
      errors.push(`${f.name}: 添付は合計 ${MAIL_ATTACHMENT_MAX_TOTAL_BYTES / MB}MB までです`);
    } else {
      accepted.push({ ...f, contentType });
      count++;
      total += f.size;
    }
  }
  return { accepted, errors };
}

/** 同じ名前が既にあれば「名前 (2).拡張子」のようにずらす(本文の目印で画像を区別するため) */
export function uniqueFilename(name: string, existing: readonly string[]): string {
  if (!existing.includes(name)) return name;
  const m = /^(.*?)(\.[^.]*)?$/.exec(name);
  const stem = m?.[1] || name;
  const ext = m?.[2] ?? '';
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!existing.includes(candidate)) return candidate;
  }
}

/** 本文中の画像の目印 */
export function inlineMarker(filename: string): string {
  return `[画像: ${filename}]`;
}

/**
 * 本文のカーソル位置に目印を差し込む。目印は 1 行に 1 つになるよう、前後が行の途中なら改行を足す。
 * 戻り値の cursor は差し込んだ目印(と改行)の直後。
 */
export function insertMarkerAt(
  text: string,
  pos: number,
  marker: string,
): { text: string; cursor: number } {
  const p = Math.max(0, Math.min(pos, text.length));
  const before = text.slice(0, p);
  const after = text.slice(p);
  const prefix = before === '' || before.endsWith('\n') ? '' : '\n';
  const suffix = after.startsWith('\n') ? '' : '\n';
  const head = `${before}${prefix}${marker}${suffix}`;
  return { text: `${head}${after}`, cursor: head.length };
}

/** 添付を外したときに本文の目印も消す。その行が目印だけなら行ごと消す */
export function removeMarker(text: string, filename: string): string {
  const marker = inlineMarker(filename);
  const lines = text.split('\n');
  const kept = lines.filter((l) => l.trim() !== marker);
  return kept.join('\n').split(marker).join('');
}

/** 本文に目印が残っている画像だけを、本文に出てくる順で返す(目印を消した画像は送らない) */
export function usedInlineAttachments<T extends { filename: string }>(
  text: string,
  items: readonly T[],
): T[] {
  return items
    .map((it) => ({ it, at: text.indexOf(inlineMarker(it.filename)) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.it);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 文字の部分を HTML にする: エスケープ・URL のリンク化・改行 → <br>・行頭の空白を保つ */
function textToHtml(text: string): string {
  return splitLinks(text.replace(/\r\n?/g, '\n'))
    .map((seg) =>
      seg.kind === 'link'
        ? `<a href="${escapeHtml(seg.value)}">${escapeHtml(seg.value)}</a>`
        : escapeHtml(seg.value),
    )
    .join('')
    .split('\n')
    .map((line) => line.replace(/^ +/, (sp) => '&nbsp;'.repeat(sp.length)))
    .join('<br>\n');
}

/**
 * 送るメールの HTML 本文を作る(本文中の画像があるときだけ使う)。テキスト本文と同じ内容で、
 * 目印「[画像: 名前]」を <img src="cid:…"> に置き換える。対応する画像の無い目印は文字のまま残す。
 */
export function buildHtmlBody(
  text: string,
  inline: ReadonlyArray<{ filename: string; cid: string }>,
): string {
  const byMarker = new Map(inline.map((i) => [inlineMarker(i.filename), i]));
  const markers = [...byMarker.keys()].sort((a, b) => b.length - a.length);
  const parts: string[] = [];
  if (markers.length === 0) {
    parts.push(textToHtml(text));
  } else {
    const re = new RegExp(
      markers.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
      'g',
    );
    let last = 0;
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      parts.push(textToHtml(text.slice(last, at)));
      const img = byMarker.get(m[0]);
      if (img) {
        parts.push(
          `<img src="cid:${escapeHtml(img.cid)}" alt="${escapeHtml(img.filename)}" style="max-width:100%;height:auto;">`,
        );
      }
      last = at + m[0].length;
    }
    parts.push(textToHtml(text.slice(last)));
  }
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head>',
    '<body><div style="font-family:sans-serif;font-size:14px;line-height:1.6;">',
    parts.join(''),
    '</div></body></html>',
  ].join('');
}

/** 画面から直接アップロードするときの置き場(利用者ごとの下書き置き場) */
export function draftStoragePath(userId: string, key: string, filename: string): string {
  return `outbox-draft/${userId}/${key}/${storageSafeName(filename)}`;
}

/** そのキーが本人の下書き置き場のものか(他人のファイル・受信メールの添付を送らせない) */
export function isOwnDraftPath(path: string, userId: string): boolean {
  const [root, owner, key, name, ...rest] = (path ?? '').split('/');
  return (
    rest.length === 0 &&
    root === 'outbox-draft' &&
    owner === userId &&
    key !== undefined &&
    name !== undefined &&
    /^[A-Za-z0-9-]+$/.test(key) &&
    /^[A-Za-z0-9._-]+$/.test(name) &&
    name !== '.' &&
    name !== '..'
  );
}

/** ファイルの先頭の印で種類を見分ける(拡張子だけ変えたファイルを送らないため) */
export function sniffAttachmentType(bytes: Uint8Array): MailAttachmentType | null {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  return null;
}

const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04];
/** 古い Office 文書(.doc / .xls / .ppt)の入れ物(OLE)の先頭の印 */
const OLE_SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
/** 新しい Office 文書(ZIP)の中にある、それぞれの本体のファイル名 */
const OOXML_MAIN_PART: Record<string, string> = {
  [DOCX_TYPE]: 'word/document.xml',
  [XLSX_TYPE]: 'xl/workbook.xml',
  [PPTX_TYPE]: 'ppt/presentation.xml',
};
const OLE_TYPES = new Set<string>([
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
]);

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  return sig.every((b, i) => bytes[i] === b);
}

function containsAscii(bytes: Uint8Array, text: string): boolean {
  const needle = Array.from(text, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * 送る前に、ファイルの中身が登録した種類と合うか確かめる(拡張子だけ変えたファイルを送らないため)。
 * PDF・JPG・PNG は先頭の印、新しい Office 文書は ZIP の印 + 中の本体のファイル名(ZIP のファイル名は圧縮されない)、
 * 古い Office 文書は OLE の先頭の印(Word / Excel / PowerPoint の区別まではしない)。
 */
export function contentMatchesType(bytes: Uint8Array, type: string): boolean {
  const mainPart = OOXML_MAIN_PART[type];
  if (mainPart) {
    return (
      startsWith(bytes, ZIP_SIG) &&
      containsAscii(bytes, '[Content_Types].xml') &&
      containsAscii(bytes, mainPart)
    );
  }
  if (OLE_TYPES.has(type)) return startsWith(bytes, OLE_SIG);
  return sniffAttachmentType(bytes) === type;
}

/** 相手に見えるファイル名を整える: 制御文字・パス区切りを "_" に、前後の空白を落とし、200 文字まで */
function sanitizeFilename(name: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字を取り除くため
  const s = (name ?? '').replace(/[\u0000-\u001f\u007f/\\]+/g, '_').trim();
  return s.slice(0, 200);
}

export interface SubmittedAttachment {
  /** アップロード先のキー(draftStoragePath) */
  path: string;
  filename: string;
  /** 本文中の画像か */
  inline: boolean;
}

export interface OutboxAttachmentRow {
  storage_path: string;
  filename: string;
  content_type: MailAttachmentType;
  size_bytes: number;
  content_id: string | null;
  sort_order: number;
}

/**
 * 承認依頼のときに、画面から来た添付の一覧を確かめて登録する行にする(サーバー用)。
 * 大きさ・種類は Storage に実際に置かれたもの(meta)で確かめ、画面の申告は使わない。
 * 本文中の画像には makeCid で cid を付ける。
 */
export function planOutboxAttachments(
  input: readonly SubmittedAttachment[] | undefined,
  meta: ReadonlyMap<string, { size: number; contentType: string | null } | undefined>,
  userId: string,
  makeCid: (index: number) => string,
): { rows?: OutboxAttachmentRow[]; error?: string } {
  const items = input ?? [];
  if (items.length === 0) return { rows: [] };
  if (items.length > MAIL_ATTACHMENT_MAX_FILES)
    return { error: `添付は ${MAIL_ATTACHMENT_MAX_FILES} ファイルまでです` };
  const rows: OutboxAttachmentRow[] = [];
  const inlineNames = new Set<string>();
  const paths = new Set<string>();
  let total = 0;
  for (const [i, it] of items.entries()) {
    const filename = sanitizeFilename(it.filename);
    if (!filename) return { error: '添付のファイル名が空です' };
    if (!isOwnDraftPath(it.path, userId) || paths.has(it.path))
      return { error: `${filename}: 添付ファイルの場所が不正です` };
    paths.add(it.path);
    const m = meta.get(it.path);
    if (!m) return { error: `${filename}: アップロードが完了していません。添付し直してください` };
    const contentType = resolveAttachmentType(filename, m.contentType);
    if (!contentType)
      return { error: `${filename}: ${MAIL_ATTACHMENT_KINDS_LABEL} 以外は添付できません` };
    if (m.size <= 0) return { error: `${filename}: 空のファイルは添付できません` };
    if (m.size > MAIL_ATTACHMENT_MAX_FILE_BYTES)
      return { error: `${filename}: 1 ファイル ${MAIL_ATTACHMENT_MAX_FILE_BYTES / MB}MB までです` };
    total += m.size;
    if (total > MAIL_ATTACHMENT_MAX_TOTAL_BYTES)
      return { error: `添付は合計 ${MAIL_ATTACHMENT_MAX_TOTAL_BYTES / MB}MB までです` };
    if (it.inline) {
      if (!isInlineImageType(contentType))
        return { error: `${filename}: 本文中に置けるのは画像(JPG・PNG)だけです` };
      if (inlineNames.has(filename))
        return { error: `${filename}: 本文中の画像の名前が重複しています` };
      inlineNames.add(filename);
    }
    rows.push({
      storage_path: it.path,
      filename,
      content_type: contentType,
      size_bytes: m.size,
      content_id: it.inline ? makeCid(i) : null,
      sort_order: i,
    });
  }
  return { rows };
}
