import { describe, expect, it } from 'vitest';
import {
  decideMaildealerPdf,
  maildealerMailKey,
  maildealerPdfFileKey,
  maildealerPdfIndexKey,
  maildealerPdfStoragePath,
} from '../../lib/domain/mail_maildealer_pdf';

describe('maildealerPdfFileKey', () => {
  it('手元のファイル名から <メールID>-<枝番>_<添付ID> を取り出す(一覧のキーと同じ形)', () => {
    expect(maildealerPdfFileKey('MD1000222-1_16379475_覚書-見本様.pdf')).toBe('1000222-1_16379475');
    expect(maildealerPdfFileKey('MD1000222-1_16379475_覚書-見本様.pdf')).toBe(
      maildealerPdfIndexKey('1000222-1', '16379475'),
    );
  });
  it('形の違うファイルは対象外(取り違えて別のメールに付けないため)', () => {
    expect(maildealerPdfFileKey('report.pdf')).toBeNull();
    expect(maildealerPdfFileKey('MD1000222_16379475_a.pdf')).toBeNull();
  });
});

describe('maildealerMailKey', () => {
  it('CSV のメールID と枝番を一覧の mail_id の形にする。枝番が空なら 1', () => {
    expect(maildealerMailKey('1128741', '1')).toBe('1128741-1');
    expect(maildealerMailKey(' 1128741 ', '')).toBe('1128741-1');
  });
});

describe('decideMaildealerPdf', () => {
  const path = maildealerPdfStoragePath('t1', 'm1', 'a'.repeat(64), 'x.pdf');
  it('保存先のキーに中身のハッシュ 16 文字が入る', () => {
    expect(path).toBe(`t1/m1/md-${'a'.repeat(16)}_x.pdf`);
  });
  it('付いていなければ付ける', () => {
    expect(
      decideMaildealerPdf({
        storagePath: path,
        filename: '見積.pdf',
        existing: [],
        plannedPaths: new Set(),
      }),
    ).toEqual({ action: 'attach' });
  });
  it('前回付けた分(同じキー)は付けない = 何度実行しても増えない', () => {
    expect(
      decideMaildealerPdf({
        storagePath: path,
        filename: '見積.pdf',
        existing: [{ filename: '見積.pdf', storage_path: path }],
        plannedPaths: new Set(),
      }),
    ).toEqual({ action: 'skip', reason: 'already_attached' });
  });
  it('SES の受信で同じ名前の添付が既にあるメールには付けない(二重表示を避ける)', () => {
    expect(
      decideMaildealerPdf({
        storagePath: path,
        filename: '見積.pdf',
        existing: [{ filename: '見積.pdf', storage_path: 't1/m1/abc_file.pdf' }],
        plannedPaths: new Set(),
      }),
    ).toEqual({ action: 'skip', reason: 'same_name_exists' });
  });
  it('この仕組みで付けた同じ名前・別の中身の PDF は別物として付ける', () => {
    const other = maildealerPdfStoragePath('t1', 'm1', 'b'.repeat(64), 'x.pdf');
    expect(
      decideMaildealerPdf({
        storagePath: path,
        filename: '見積.pdf',
        existing: [{ filename: '見積.pdf', storage_path: other }],
        plannedPaths: new Set(),
      }),
    ).toEqual({ action: 'attach' });
  });
  it('同じ実行の中で同じキーを二度付けない', () => {
    expect(
      decideMaildealerPdf({
        storagePath: path,
        filename: '見積.pdf',
        existing: [],
        plannedPaths: new Set([path]),
      }),
    ).toEqual({ action: 'skip', reason: 'duplicate_in_run' });
  });
});
