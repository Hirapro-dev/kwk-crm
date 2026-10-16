/**
 * メール本文の表示(CLAUDE.md §5.15 セキュリティ)。
 * 意図: 本文中のリンクは別タブで開ける(2026-10-16 修正。以前は枠の設定でブラウザが黙って止めていた)。
 *       ただし本文の枠の中でスクリプトを動かす・親画面(メーラー)を書き換える・フォームを送る、は引き続き禁止する。
 */
import { MAIL_BODY_IFRAME_SANDBOX, stripAnchorTargets } from '@/lib/domain/mail_body_view';
import { describe, expect, it } from 'vitest';

describe('MAIL_BODY_IFRAME_SANDBOX', () => {
  const tokens = MAIL_BODY_IFRAME_SANDBOX.split(/\s+/);
  it('リンクを新しいタブで開け、開いた先は普通のページとして動く', () => {
    expect(tokens).toContain('allow-popups');
    expect(tokens).toContain('allow-popups-to-escape-sandbox');
  });
  it('スクリプト・同一オリジン扱い・親画面の書き換え・フォーム送信は許可しない', () => {
    for (const t of [
      'allow-scripts',
      'allow-same-origin',
      'allow-top-navigation',
      'allow-top-navigation-by-user-activation',
      'allow-forms',
    ]) {
      expect(tokens).not.toContain(t);
    }
  });
});

describe('stripAnchorTargets', () => {
  it('a タグの target を外し、<base target="_blank"> で新しいタブに開くようにする', () => {
    expect(stripAnchorTargets('<a href="https://x.jp" target="_self">x</a>')).toBe(
      '<a href="https://x.jp">x</a>',
    );
    expect(stripAnchorTargets("<A TARGET='_top' href='https://x.jp'>x</A>")).toBe(
      "<A href='https://x.jp'>x</A>",
    );
    expect(stripAnchorTargets('<a target=_parent href="https://x.jp">x</a>')).toBe(
      '<a href="https://x.jp">x</a>',
    );
  });
  it('a タグ以外や本文中の文字は変えない', () => {
    const html = '<form target="_self"></form><p>target="_self" と書いた本文</p>';
    expect(stripAnchorTargets(html)).toBe(html);
  });
});
