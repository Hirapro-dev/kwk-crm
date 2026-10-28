/**
 * メーラーの「送信済み」「自分の送信履歴」(CLAUDE.md §5.15。2026-10-28 ユーザー要望)の純粋関数のテスト。
 * 意図: 送信メールは約 22 万通あり件数を数えると重いため、「次の 50 件」は送信日時と ID の続き位置(カーソル)で読む。
 * URL から来る値なので、形の違うものは捨てて先頭から読み直す(DB に変な値を送らない)。
 */
import {
  boxSentTabHref,
  isBoxSentView,
  parseSentCursor,
  sentCursorOf,
  sentFolderHref,
} from '@/lib/domain/mail_sent';
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

describe('受信箱ごとの「送信済み」タブ(2026-10-28 ユーザー指定)', () => {
  // 意図: 送信済みは受信箱(アドレス)ごとに見る。受信箱を選んでいるときだけタブを出し、
  // 「すべての受信箱」「取込候補」「その他」では出さない(どのアドレスの送信か決まらないため)。
  it('受信箱を選んで tab=sent のときだけ送信済みの表示にする', () => {
    expect(isBoxSentView({ tab: 'sent', boxId: 3 })).toBe(true);
    expect(isBoxSentView({ tab: 'sent', boxId: undefined })).toBe(false);
    expect(isBoxSentView({ tab: 'all', boxId: 3 })).toBe(false);
    expect(isBoxSentView({ tab: 'sent', boxId: 3, folder: 'candidates' })).toBe(false);
    expect(isBoxSentView({ tab: 'sent', boxId: 3, folder: 'unsorted' })).toBe(false);
  });
  it('タブの URL(続きの位置付き)', () => {
    expect(boxSentTabHref(3)).toBe('/mail?box=3&tab=sent');
    expect(boxSentTabHref(3, 'x_y')).toBe('/mail?box=3&tab=sent&before=x_y');
  });
});
