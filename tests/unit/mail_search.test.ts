/**
 * メーラーの検索(migration 125)。
 * 意図: メールアドレスを入れたら「そのお客様とのやり取り全部」を探すアドレス検索になり、
 *       それ以外は件名・本文などのテキスト検索になる。状態タブ・受信箱などの絞り込みは一覧と同じ意味で効く。
 */
import {
  MAIL_SEARCH_LIMIT,
  type MailSearchHit,
  adjacentInHits,
  filterMailSearchHits,
  mailSearchNote,
  parseMailSearch,
} from '@/lib/domain/mail_search';
import { describe, expect, it } from 'vitest';

describe('parseMailSearch', () => {
  it('メールアドレスはアドレス検索(小文字にそろえる)', () => {
    expect(parseMailSearch(' Taro@Example.COM ')).toEqual({
      mode: 'address',
      term: 'taro@example.com',
    });
  });
  it('「氏名 <アドレス>」の形もアドレス検索', () => {
    expect(parseMailSearch('山田 太郎 <taro@example.com>')).toEqual({
      mode: 'address',
      term: 'taro@example.com',
    });
  });
  it('それ以外はテキスト検索。空白は 1 つにまとめる', () => {
    expect(parseMailSearch('  未来予測   レポート ')).toEqual({
      mode: 'text',
      term: '未来予測 レポート',
    });
    expect(parseMailSearch('example.com')?.mode).toBe('text');
    expect(parseMailSearch('@だけ')?.mode).toBe('text');
  });
  it('空は null', () => {
    expect(parseMailSearch('   ')).toBeNull();
    expect(parseMailSearch(undefined)).toBeNull();
  });
});

const hit = (over: Partial<MailSearchHit>): MailSearchHit => ({
  id: 'x',
  mail_box_id: 1,
  status: '未対応',
  category: '通常',
  assignee_id: null,
  is_read: false,
  is_import_candidate: false,
  last_message_at: '2026-10-19T00:00:00Z',
  ...over,
});

describe('filterMailSearchHits', () => {
  const hits = [
    hit({ id: 'a', status: '未対応', mail_box_id: 1 }),
    hit({ id: 'b', status: '完了', mail_box_id: 2, assignee_id: 'u1', is_read: true }),
    hit({ id: 'c', status: '対応中', category: 'メルマガ', mail_box_id: 3 }),
  ];
  it('条件なしなら全部(すべての受信箱・すべての状態)', () => {
    expect(filterMailSearchHits(hits, {}).map((h) => h.id)).toEqual(['a', 'b', 'c']);
  });
  it('状態・分類・受信箱・担当・未読で絞れる', () => {
    expect(filterMailSearchHits(hits, { status: '完了' }).map((h) => h.id)).toEqual(['b']);
    expect(filterMailSearchHits(hits, { category: '通常' }).map((h) => h.id)).toEqual(['a', 'b']);
    expect(filterMailSearchHits(hits, { mailBoxIds: [1, 3] }).map((h) => h.id)).toEqual(['a', 'c']);
    expect(filterMailSearchHits(hits, { assigneeId: 'none' }).map((h) => h.id)).toEqual(['a', 'c']);
    expect(filterMailSearchHits(hits, { assigneeId: 'u1' }).map((h) => h.id)).toEqual(['b']);
    expect(filterMailSearchHits(hits, { unreadOnly: true }).map((h) => h.id)).toEqual(['a', 'c']);
  });
});

describe('adjacentInHits / mailSearchNote', () => {
  it('検索結果の並びで前後を返す', () => {
    const hits = [hit({ id: 'a' }), hit({ id: 'b' }), hit({ id: 'c' })];
    expect(adjacentInHits(hits, 'b')).toEqual({ prevId: 'a', nextId: 'c' });
    expect(adjacentInHits(hits, 'z')).toEqual({ prevId: null, nextId: null });
  });
  it('上限に達したら絞り込みを促す', () => {
    const p = { mode: 'text' as const, term: '様' };
    expect(mailSearchNote(p, MAIL_SEARCH_LIMIT)).toContain('絞り込んでください');
    expect(mailSearchNote(p, 3)).not.toContain('絞り込んでください');
  });
});
