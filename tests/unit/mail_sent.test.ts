/**
 * メーラーの「送信済み」「自分の送信履歴」(CLAUDE.md §5.15。2026-10-28 ユーザー要望)の純粋関数のテスト。
 * 意図: 送信メールは約 22 万通あり件数を数えると重いため、「次の 50 件」は送信日時と ID の続き位置(カーソル)で読む。
 * URL から来る値なので、形の違うものは捨てて先頭から読み直す(DB に変な値を送らない)。
 */
import { parseSentCursor, sentCursorOf, sentFolderHref } from '@/lib/domain/mail_sent';
import { describe, expect, it } from 'vitest';

const ID = '0bb98130-24e3-4623-8c0a-24deabdb26e4';

describe('sentCursorOf / parseSentCursor', () => {
  it('送信日時と ID から作り、読み戻せる', () => {
    const c = sentCursorOf({ sent_at: '2026-10-28T01:39:17.994+00:00', id: ID });
    expect(parseSentCursor(c)).toEqual({ sentAt: '2026-10-28T01:39:17.994Z', id: ID });
  });
  it('形の違う値・空は null(先頭から読む)', () => {
    expect(parseSentCursor(undefined)).toBeNull();
    expect(parseSentCursor('')).toBeNull();
    expect(parseSentCursor('abc')).toBeNull();
    expect(parseSentCursor(`not-a-date_${ID}`)).toBeNull();
    expect(parseSentCursor('2026-10-28T01:39:17Z_not-a-uuid')).toBeNull();
    expect(parseSentCursor(`2026-10-28T01:39:17Z_${ID}),or(id.gt.0`)).toBeNull();
  });
});

describe('sentFolderHref', () => {
  it('全体と自分の送信履歴の URL(続きの位置付き)', () => {
    expect(sentFolderHref({ mine: false })).toBe('/mail/sent');
    expect(sentFolderHref({ mine: true })).toBe('/mail/sent?mine=1');
    expect(sentFolderHref({ mine: true, before: 'x_y' })).toBe('/mail/sent?mine=1&before=x_y');
  });
});
