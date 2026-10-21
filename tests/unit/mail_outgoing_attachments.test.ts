/**
 * メーラーの送信メールの添付(CLAUDE.md §5.15「送信メールの添付」/ migration 128)の純粋関数のテスト。
 * 意図: 送れるのは PDF・JPG・PNG だけ・1 ファイル 10MB / 合計 15MB / 10 ファイルまで(2026-10-21 ユーザー決定)。
 *       本文に落とした画像は「[画像: 名前]」の目印の位置に表示し、目印を消した画像は送らない。
 *       HTML 本文は利用者の文字をそのまま(タグとして解釈させずに)出す。
 */
import {
  MAIL_ATTACHMENT_MAX_FILES,
  MAIL_ATTACHMENT_MAX_TOTAL_BYTES,
  buildHtmlBody,
  checkNewAttachments,
  draftStoragePath,
  inlineMarker,
  insertMarkerAt,
  isOwnDraftPath,
  planOutboxAttachments,
  removeMarker,
  resolveAttachmentType,
  sniffAttachmentType,
  uniqueFilename,
  usedInlineAttachments,
} from '@/lib/domain/mail_outgoing_attachments';
import { describe, expect, it } from 'vitest';

const MB = 1024 * 1024;

describe('resolveAttachmentType', () => {
  it('PDF・JPG・PNG は種類を返す(ブラウザが種類を付けない場合は拡張子で判断)', () => {
    expect(resolveAttachmentType('a.pdf', 'application/pdf')).toBe('application/pdf');
    expect(resolveAttachmentType('写真.JPG', '')).toBe('image/jpeg');
    expect(resolveAttachmentType('a.jpeg', 'image/jpeg')).toBe('image/jpeg');
    expect(resolveAttachmentType('a.png', 'image/png')).toBe('image/png');
  });
  it('それ以外(Excel・GIF・拡張子なし・種類と拡張子の食い違い)は null', () => {
    expect(resolveAttachmentType('a.xlsx', '')).toBeNull();
    expect(resolveAttachmentType('a.gif', 'image/gif')).toBeNull();
    expect(resolveAttachmentType('a', 'application/pdf')).toBeNull();
    expect(resolveAttachmentType('a.png', 'application/pdf')).toBeNull();
  });
});

describe('checkNewAttachments', () => {
  it('条件を満たすものは受け付け、種類が違うものは理由付きで弾く', () => {
    const r = checkNewAttachments(
      [],
      [
        { name: 'a.pdf', size: 1 * MB, type: 'application/pdf' },
        { name: 'b.xlsx', size: 1 * MB, type: '' },
      ],
    );
    expect(r.accepted.map((a) => a.name)).toEqual(['a.pdf']);
    expect(r.accepted[0]?.contentType).toBe('application/pdf');
    expect(r.errors.join()).toContain('b.xlsx');
  });
  it('1 ファイル 10MB を超えるもの・空のものは弾く', () => {
    const r = checkNewAttachments(
      [],
      [
        { name: 'big.pdf', size: 10 * MB + 1, type: 'application/pdf' },
        { name: 'empty.png', size: 0, type: 'image/png' },
      ],
    );
    expect(r.accepted).toEqual([]);
    expect(r.errors).toHaveLength(2);
  });
  it('既にある分と合わせて合計 15MB を超える分は弾く', () => {
    const r = checkNewAttachments(
      [{ size: 9 * MB }],
      [
        { name: 'a.pdf', size: 5 * MB, type: 'application/pdf' },
        { name: 'b.pdf', size: 2 * MB, type: 'application/pdf' },
      ],
    );
    expect(r.accepted.map((a) => a.name)).toEqual(['a.pdf']);
    expect(r.errors.join()).toContain('15MB');
    expect(MAIL_ATTACHMENT_MAX_TOTAL_BYTES).toBe(15 * MB);
  });
  it('10 ファイルを超える分は弾く', () => {
    const current = Array.from({ length: MAIL_ATTACHMENT_MAX_FILES - 1 }, () => ({ size: 1 }));
    const r = checkNewAttachments(current, [
      { name: 'a.png', size: 1, type: 'image/png' },
      { name: 'b.png', size: 1, type: 'image/png' },
    ]);
    expect(r.accepted.map((a) => a.name)).toEqual(['a.png']);
    expect(r.errors.join()).toContain('10');
  });
});

describe('uniqueFilename', () => {
  it('同じ名前があれば (2)(3)… を付ける(目印で画像を区別するため)', () => {
    expect(uniqueFilename('a.png', [])).toBe('a.png');
    expect(uniqueFilename('a.png', ['a.png'])).toBe('a (2).png');
    expect(uniqueFilename('a.png', ['a.png', 'a (2).png'])).toBe('a (3).png');
    expect(uniqueFilename('README', ['README'])).toBe('README (2)');
  });
});

describe('本文中の目印', () => {
  it('目印は「[画像: 名前]」', () => {
    expect(inlineMarker('a.png')).toBe('[画像: a.png]');
  });
  it('カーソルの位置に、前後を改行で区切って差し込む', () => {
    const r = insertMarkerAt('前後', 1, '[画像: a.png]');
    expect(r.text).toBe('前\n[画像: a.png]\n後');
    expect(r.cursor).toBe('前\n[画像: a.png]\n'.length);
  });
  it('行の頭・末尾ではよけいな改行を足さない', () => {
    expect(insertMarkerAt('', 0, '[画像: a.png]').text).toBe('[画像: a.png]\n');
    expect(insertMarkerAt('あ\n', 2, '[画像: a.png]').text).toBe('あ\n[画像: a.png]\n');
  });
  it('添付を外したら本文の目印も消す(その行が目印だけなら行ごと)', () => {
    expect(removeMarker('前\n[画像: a.png]\n後', 'a.png')).toBe('前\n後');
    expect(removeMarker('前 [画像: a.png] 後', 'a.png')).toBe('前  後');
  });
  it('本文に目印が残っている画像だけを、本文に出てくる順で返す', () => {
    const items = [
      { filename: 'a.png', cid: 'a' },
      { filename: 'b.png', cid: 'b' },
      { filename: 'c.png', cid: 'c' },
    ];
    const used = usedInlineAttachments('x\n[画像: c.png]\n[画像: a.png]', items);
    expect(used.map((u) => u.cid)).toEqual(['c', 'a']);
  });
});

describe('buildHtmlBody', () => {
  it('目印を <img src="cid:…"> にし、改行を <br> にする', () => {
    const html = buildHtmlBody('こんにちは\n[画像: a.png]\nよろしく', [
      { filename: 'a.png', cid: 'img1@crm' },
    ]);
    expect(html).toContain('こんにちは<br>');
    expect(html).toContain('<img src="cid:img1@crm" alt="a.png"');
    expect(html).toContain('よろしく');
  });
  it('利用者の文字はエスケープする(タグとして解釈させない)', () => {
    const html = buildHtmlBody('<script>alert(1)</script> & "x"', []);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });
  it('URL はリンクにする', () => {
    const html = buildHtmlBody('詳細 https://example.com/a?b=1&c=2 です', []);
    expect(html).toContain('<a href="https://example.com/a?b=1&amp;c=2">');
  });
  it('対応する画像の無い目印は文字のまま残す', () => {
    expect(buildHtmlBody('[画像: x.png]', [])).toContain('[画像: x.png]');
  });
  it('ファイル名に記号があっても目印を置き換えられる', () => {
    const html = buildHtmlBody('[画像: a(1)+[b].png]', [{ filename: 'a(1)+[b].png', cid: 'c1' }]);
    expect(html).toContain('cid:c1');
  });
});

describe('アップロード先', () => {
  it('利用者ごとの下書き置き場に、Storage で使える名前で置く', () => {
    const p = draftStoragePath('u-1', 'abc', '見積書.pdf');
    expect(p).toBe('outbox-draft/u-1/abc/file.pdf');
    expect(isOwnDraftPath(p, 'u-1')).toBe(true);
  });
  it('他人の置き場・別の場所・「..」を含むキーは本人のものと認めない', () => {
    expect(isOwnDraftPath('outbox-draft/u-2/abc/file.pdf', 'u-1')).toBe(false);
    expect(isOwnDraftPath('thread/x/file.pdf', 'u-1')).toBe(false);
    expect(isOwnDraftPath('outbox-draft/u-1/../u-2/file.pdf', 'u-1')).toBe(false);
  });
});

describe('sniffAttachmentType', () => {
  it('ファイルの先頭の印で PDF・JPG・PNG を見分ける', () => {
    expect(sniffAttachmentType(new TextEncoder().encode('%PDF-1.7'))).toBe('application/pdf');
    expect(sniffAttachmentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(
      sniffAttachmentType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('image/png');
  });
  it('それ以外は null(拡張子だけ変えたファイルを送らない)', () => {
    expect(sniffAttachmentType(new TextEncoder().encode('PK\x03\x04'))).toBeNull();
    expect(sniffAttachmentType(new Uint8Array([]))).toBeNull();
  });
});

describe('planOutboxAttachments(承認依頼のときにサーバーで確かめる)', () => {
  const uid = 'u-1';
  const p1 = 'outbox-draft/u-1/k1/a.pdf';
  const p2 = 'outbox-draft/u-1/k2/b.png';
  const meta = new Map([
    [p1, { size: 2 * MB, contentType: 'application/pdf' }],
    [p2, { size: 1 * MB, contentType: 'image/png' }],
  ]);
  const cid = (i: number) => `img${i}@crm`;

  it('通常の添付と本文中の画像を、並び順・cid 付きの行にする', () => {
    const r = planOutboxAttachments(
      [
        { path: p1, filename: '見積書.pdf', inline: false },
        { path: p2, filename: '地図.png', inline: true },
      ],
      meta,
      uid,
      cid,
    );
    expect(r.error).toBeUndefined();
    expect(r.rows).toEqual([
      {
        storage_path: p1,
        filename: '見積書.pdf',
        content_type: 'application/pdf',
        size_bytes: 2 * MB,
        content_id: null,
        sort_order: 0,
      },
      {
        storage_path: p2,
        filename: '地図.png',
        content_type: 'image/png',
        size_bytes: 1 * MB,
        content_id: 'img1@crm',
        sort_order: 1,
      },
    ]);
  });
  it('添付なしは空', () => {
    expect(planOutboxAttachments(undefined, meta, uid, cid)).toEqual({ rows: [] });
  });
  it('他人の置き場・アップロードされていないファイルは受け付けない', () => {
    expect(
      planOutboxAttachments(
        [{ path: 'outbox-draft/u-2/k/a.pdf', filename: 'a.pdf', inline: false }],
        meta,
        uid,
        cid,
      ).error,
    ).toBeTruthy();
    expect(
      planOutboxAttachments(
        [{ path: 'outbox-draft/u-1/k9/x.pdf', filename: 'x.pdf', inline: false }],
        meta,
        uid,
        cid,
      ).error,
    ).toBeTruthy();
  });
  it('実際の大きさ・種類で確かめる(画面の申告は信用しない)', () => {
    const big = new Map([[p1, { size: 11 * MB, contentType: 'application/pdf' }]]);
    expect(
      planOutboxAttachments([{ path: p1, filename: 'a.pdf', inline: false }], big, uid, cid).error,
    ).toContain('10MB');
    const wrong = new Map([[p1, { size: 1, contentType: 'application/zip' }]]);
    expect(
      planOutboxAttachments([{ path: p1, filename: 'a.pdf', inline: false }], wrong, uid, cid)
        .error,
    ).toBeTruthy();
  });
  it('PDF は本文中に置けない。本文中の画像の名前は重複させない', () => {
    expect(
      planOutboxAttachments([{ path: p1, filename: 'a.pdf', inline: true }], meta, uid, cid).error,
    ).toBeTruthy();
    const two = new Map([
      [p2, { size: 1, contentType: 'image/png' }],
      ['outbox-draft/u-1/k3/b.png', { size: 1, contentType: 'image/png' }],
    ]);
    expect(
      planOutboxAttachments(
        [
          { path: p2, filename: 'b.png', inline: true },
          { path: 'outbox-draft/u-1/k3/b.png', filename: 'b.png', inline: true },
        ],
        two,
        uid,
        cid,
      ).error,
    ).toBeTruthy();
  });
  it('ファイル名の制御文字・パス区切りは取り除く', () => {
    const r = planOutboxAttachments(
      [{ path: p1, filename: '../\u0000a/b.pdf', inline: false }],
      meta,
      uid,
      cid,
    );
    expect(r.rows?.[0]?.filename).toBe('.._a_b.pdf');
  });
});
