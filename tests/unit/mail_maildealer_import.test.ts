import { describe, expect, it } from 'vitest';
import {
  looksLikeHtmlBody,
  maildealerAssigneeToken,
  mapMaildealerThreadStatus,
} from '../../lib/domain/mail_maildealer_import';

/**
 * メールディーラー CSV 取込の決定論的ロジック(CLAUDE.md §5.15)。
 * 2026-09-11 にユーザーと確認した「状態はそのまま反映」「担当者はあいまいなら割り当てない」
 * という方針の入力になる変換なので、意図を固定する。
 */

describe('mapMaildealerThreadStatus', () => {
  it('送信メールは対応中(ライブの返信時と同じ)', () => {
    expect(mapMaildealerThreadStatus('送信メール', '送信メール')).toBe('対応中');
  });
  it('受信メールの「新着」は未対応', () => {
    expect(mapMaildealerThreadStatus('受信メール', '新着')).toBe('未対応');
  });
  it('受信メールの「対応完了」は完了', () => {
    expect(mapMaildealerThreadStatus('受信メール', '対応完了')).toBe('完了');
  });
  it('想定外の値は null(状態を変えない判断に使う)', () => {
    expect(mapMaildealerThreadStatus('受信メール', '')).toBeNull();
    expect(mapMaildealerThreadStatus('受信メール', '不明な値')).toBeNull();
  });
});

describe('maildealerAssigneeToken', () => {
  it('前後の空白を除き小文字化する', () => {
    expect(maildealerAssigneeToken('  Miyamoto  ')).toBe('miyamoto');
  });
  it('退職者の "(deleted_id:N)" 注記を取り除く', () => {
    expect(maildealerAssigneeToken('hayakawa(deleted_id:1425)')).toBe('hayakawa');
  });
  it('空・null は空文字', () => {
    expect(maildealerAssigneeToken('')).toBe('');
    expect(maildealerAssigneeToken(null)).toBe('');
  });
});

describe('looksLikeHtmlBody', () => {
  it('html/body/table/div/p タグを含めば HTML と判定する', () => {
    expect(looksLikeHtmlBody('<html><body>x</body></html>')).toBe(true);
    expect(looksLikeHtmlBody('<table><tr><td>x</td></tr></table>')).toBe(true);
    expect(looksLikeHtmlBody('<div>x</div>')).toBe(true);
    expect(looksLikeHtmlBody('<p>x</p>')).toBe(true);
  });
  it('プレーンテキストは false', () => {
    expect(looksLikeHtmlBody('お世話になっております。')).toBe(false);
    expect(looksLikeHtmlBody('価格は1<2として…')).toBe(false);
  });
  it('空・null は false', () => {
    expect(looksLikeHtmlBody('')).toBe(false);
    expect(looksLikeHtmlBody(null)).toBe(false);
  });
});
