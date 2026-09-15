import { describe, expect, it } from 'vitest';
import { isImportCandidate } from '../../lib/domain/mail_import_candidates';
import {
  MAIL_IMPORT_CANDIDATE_ADDRESSES,
  MAIL_IMPORT_CANDIDATE_SUBJECT_KEYWORDS,
} from '../../lib/domain/mail_types';

/**
 * 「取込候補」の判定(CLAUDE.md §5.15 / migration 82)。
 *
 * 旧 Salesforce の「メール to リード」用アドレスを宛先(To/Cc)に含むメールは、
 * フォーム通知などリード/問合せとして取り込むべき候補。受信時にこの純粋関数で
 * 決定論的に判定し、スレッドに印を付けて左フォルダ「取込候補」に出す。
 */
describe('isImportCandidate', () => {
  const target = 'y3awtd-hirayama-p@hdbronze.htdb.jp';

  it('既定の判定アドレスに旧「メール to リード」宛先が含まれている', () => {
    expect(MAIL_IMPORT_CANDIDATE_ADDRESSES).toContain(target);
  });

  it('To に判定アドレスを含むとき候補になる', () => {
    expect(isImportCandidate(['quest@kawaraban.co.jp', target], [])).toBe(true);
  });

  it('Cc に判定アドレスを含むとき候補になる', () => {
    expect(isImportCandidate(['quest@kawaraban.co.jp'], [target])).toBe(true);
  });

  it('大文字小文字や前後の空白が違っても同じアドレスとして扱う', () => {
    expect(isImportCandidate([` ${target.toUpperCase()} `], [])).toBe(true);
  });

  it('判定アドレスを含まないときは候補にならない', () => {
    expect(isImportCandidate(['quest@kawaraban.co.jp'], ['someone@example.com'])).toBe(false);
  });

  it('宛先が空のときは候補にならない', () => {
    expect(isImportCandidate([], [])).toBe(false);
  });

  it('部分一致では候補にしない(別ドメインの似たアドレスを拾わない)', () => {
    expect(isImportCandidate([`x${target}`], [])).toBe(false);
    expect(isImportCandidate([`${target}.example.com`], [])).toBe(false);
  });

  it('判定アドレス一覧を差し替えられる(将来の設定化のため)', () => {
    expect(isImportCandidate(['lead@example.com'], [], ['lead@example.com'])).toBe(true);
    expect(isImportCandidate([target], [], ['lead@example.com'])).toBe(false);
  });

  // 2026-09-15 追加: 宛先に判定アドレスが無くても、件名に判定キーワードを含めば候補にする
  // (エキスパのフォーム登録通知は判定アドレス宛に来ないため)
  describe('件名のキーワード', () => {
    const keyword = '[エキスパ]フォーム登録通知';

    it('既定の判定キーワードにエキスパのフォーム登録通知が含まれている', () => {
      expect(MAIL_IMPORT_CANDIDATE_SUBJECT_KEYWORDS).toContain(keyword);
    });

    it('宛先に判定アドレスが無くても、件名にキーワードを含めば候補になる', () => {
      expect(
        isImportCandidate(['quest@kawaraban.co.jp'], [], undefined, `${keyword} 山田 太郎 様`),
      ).toBe(true);
    });

    it('件名がキーワードを含まなければ、宛先だけで判定する(従来どおり)', () => {
      expect(isImportCandidate(['quest@kawaraban.co.jp'], [], undefined, 'お問い合わせ')).toBe(
        false,
      );
      expect(isImportCandidate([target], [], undefined, 'お問い合わせ')).toBe(true);
    });

    it('件名が無い(null)ときは宛先だけで判定する', () => {
      expect(isImportCandidate(['quest@kawaraban.co.jp'], [], undefined, null)).toBe(false);
    });

    it('キーワードは部分一致(件名のどこにあってもよい)で、大文字小文字は区別しない', () => {
      expect(isImportCandidate([], [], undefined, `Re: ${keyword}`)).toBe(true);
      expect(isImportCandidate([], [], undefined, '[エキスパ]フォーム登録通知'.toLowerCase())).toBe(
        true,
      );
    });

    it('判定キーワード一覧を差し替えられる', () => {
      expect(isImportCandidate([], [], [], '【申込】通知', ['【申込】通知'])).toBe(true);
      expect(isImportCandidate([], [], [], keyword, ['【申込】通知'])).toBe(false);
    });
  });
});
