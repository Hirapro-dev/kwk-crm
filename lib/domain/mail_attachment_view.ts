/**
 * メーラーの添付の見せ方(CLAUDE.md §5.15)の純粋関数。2026-10-23 ユーザー要望: 添付があることを分かりやすく
 * (スレッドの画面で目立たせる・一覧の件名にクリップを出す)。
 */

/** 利用者が開くファイルではない部品(電子署名・ヘッダーだけの部品など)。「添付あり」に数えない */
const NON_FILE_TYPES = new Set([
  'application/pkcs7-signature',
  'application/x-pkcs7-signature',
  'application/pgp-signature',
  'text/rfc822-headers',
  'message/delivery-status',
  'message/disposition-notification',
]);

function isFileAttachment(contentType: string | null | undefined): boolean {
  return !NON_FILE_TYPES.has((contentType ?? '').trim().toLowerCase());
}

/** 添付を、開くファイル(files)と電子署名などの部品(hidden)に分ける。並びは保つ */
export function splitVisibleAttachments<T extends { content_type: string | null }>(
  list: readonly T[],
): { files: T[]; hidden: T[] } {
  const files: T[] = [];
  const hidden: T[] = [];
  for (const a of list) (isFileAttachment(a.content_type) ? files : hidden).push(a);
  return { files, hidden };
}

/** スレッドごとの添付ファイルの数(電子署名などは数えない。0 のスレッドは入れない) */
export function attachmentCountsByThread(
  rows: readonly { thread_id: string; attachments: readonly { content_type: string | null }[] }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const n = r.attachments.filter((a) => isFileAttachment(a.content_type)).length;
    if (n > 0) out.set(r.thread_id, (out.get(r.thread_id) ?? 0) + n);
  }
  return out;
}

export type AttachmentKind =
  | 'pdf'
  | 'excel'
  | 'word'
  | 'powerpoint'
  | 'image'
  | 'archive'
  | 'text'
  | 'other';

const EXT_KIND: Record<string, AttachmentKind> = {
  pdf: 'pdf',
  xlsx: 'excel',
  xls: 'excel',
  xlsm: 'excel',
  csv: 'excel',
  docx: 'word',
  doc: 'word',
  docm: 'word',
  pptx: 'powerpoint',
  ppt: 'powerpoint',
  pptm: 'powerpoint',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  heic: 'image',
  zip: 'archive',
  gz: 'archive',
  lzh: 'archive',
  '7z': 'archive',
  txt: 'text',
};

const KIND_NAME: Record<AttachmentKind, string> = {
  pdf: 'PDF',
  excel: 'Excel',
  word: 'Word',
  powerpoint: 'PowerPoint',
  image: '画像',
  archive: '圧縮',
  text: 'テキスト',
  other: 'ファイル',
};

/** 添付の種類(アイコンの色分け用)と、アイコンに出す文字(拡張子。無ければ種類の名前) */
export function attachmentKind(
  filename: string | null | undefined,
  contentType: string | null | undefined,
): { kind: AttachmentKind; label: string } {
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(filename ?? '')?.[1]?.toLowerCase() ?? '';
  const t = (contentType ?? '').toLowerCase();
  let kind: AttachmentKind = EXT_KIND[ext] ?? 'other';
  if (kind === 'other') {
    if (t === 'application/pdf') kind = 'pdf';
    else if (t.startsWith('image/')) kind = 'image';
    else if (t.includes('spreadsheet') || t.includes('ms-excel')) kind = 'excel';
    else if (t.includes('wordprocessing') || t === 'application/msword') kind = 'word';
    else if (t.includes('presentation') || t.includes('ms-powerpoint')) kind = 'powerpoint';
    else if (t.includes('zip') || t.includes('compressed')) kind = 'archive';
  }
  return { kind, label: ext ? ext.toUpperCase() : KIND_NAME[kind] };
}
