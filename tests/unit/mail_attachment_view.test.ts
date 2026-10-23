/**
 * メーラーの添付の見せ方(CLAUDE.md §5.15。2026-10-23 ユーザー要望: 添付があることを分かりやすく)の純粋関数のテスト。
 * 意図: 電子署名(S/MIME)など、利用者が開くファイルではない添付は「添付あり」に数えない(一覧のクリップが
 * 署名付きメールすべてに付くと意味がなくなるため)。種類ごとにアイコンを出し分ける。
 */
import {
  attachmentCountsByThread,
  attachmentKind,
  splitVisibleAttachments,
} from '@/lib/domain/mail_attachment_view';
import { describe, expect, it } from 'vitest';

describe('splitVisibleAttachments', () => {
  it('電子署名・ヘッダーだけの部品は「その他」に分け、それ以外を添付ファイルとして返す', () => {
    const r = splitVisibleAttachments([
      { id: '1', content_type: 'application/pdf' },
      { id: '2', content_type: 'application/pkcs7-signature' },
      { id: '3', content_type: 'application/x-pkcs7-signature' },
      { id: '4', content_type: 'text/rfc822-headers' },
      { id: '5', content_type: 'image/png' },
      { id: '6', content_type: null },
    ]);
    expect(r.files.map((a) => a.id)).toEqual(['1', '5', '6']);
    expect(r.hidden.map((a) => a.id)).toEqual(['2', '3', '4']);
  });
});

describe('attachmentCountsByThread(一覧のクリップ用)', () => {
  it('スレッドごとに添付ファイルの数を合計する(電子署名は数えない)', () => {
    const m = attachmentCountsByThread([
      {
        thread_id: 't1',
        attachments: [{ content_type: 'application/pdf' }, { content_type: 'image/png' }],
      },
      { thread_id: 't1', attachments: [{ content_type: 'application/msword' }] },
      { thread_id: 't2', attachments: [{ content_type: 'application/pkcs7-signature' }] },
      { thread_id: 't3', attachments: [] },
    ]);
    expect(m.get('t1')).toBe(3);
    expect(m.has('t2')).toBe(false);
    expect(m.has('t3')).toBe(false);
  });
});

describe('attachmentKind(アイコンの出し分け)', () => {
  it('拡張子と種類から見分ける', () => {
    expect(attachmentKind('見積.pdf', 'application/pdf').kind).toBe('pdf');
    expect(attachmentKind('a.xlsx', 'application/octet-stream').kind).toBe('excel');
    expect(attachmentKind('a.csv', 'text/csv').kind).toBe('excel');
    expect(attachmentKind('a.docx', null).kind).toBe('word');
    expect(attachmentKind('a.PPT', null).kind).toBe('powerpoint');
    expect(attachmentKind('写真', 'image/jpeg').kind).toBe('image');
    expect(attachmentKind('a.zip', 'application/zip').kind).toBe('archive');
    expect(attachmentKind('a.bin', 'application/octet-stream').kind).toBe('other');
  });
  it('アイコンの文字は拡張子(無ければ種類の名前)', () => {
    expect(attachmentKind('a.xlsx', null).label).toBe('XLSX');
    expect(attachmentKind('写真', 'image/jpeg').label).toBe('画像');
  });
});
