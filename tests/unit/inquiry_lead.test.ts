import { describe, expect, it } from 'vitest';
import {
  inquiryOverridesForMember,
  matchedFieldsLabel,
  memberMatchLabel,
} from '../../lib/domain/inquiry_lead';

/**
 * 問合せ一覧のリード操作(CLAUDE.md §5.16 段階④)の表示ロジック。
 * 会員の自動照合結果(member_match)と会員IDの有無から、行に出す状態の文言を決める。
 */
describe('memberMatchLabel', () => {
  it('会員が紐付いていれば「会員化済」(自動紐付けなら「自動」を添える)', () => {
    expect(memberMatchLabel({ status: 'auto', points: 3, candidates: ['K-1'] }, 'K-1')).toEqual({
      text: '会員化済(自動)',
      tone: 'ok',
    });
    expect(memberMatchLabel({ status: 'manual', points: 0, candidates: [] }, 'K-9')).toEqual({
      text: '会員化済',
      tone: 'ok',
    });
    expect(memberMatchLabel(null, 'K-9')).toEqual({ text: '会員化済', tone: 'ok' });
  });

  it('未紐付けは照合結果に応じて「候補あり」「該当なし」「確認済み」、結果が無ければ「未照合」', () => {
    expect(
      memberMatchLabel({ status: 'candidates', points: 2, candidates: ['K-1', 'K-2'] }, null),
    ).toEqual({
      text: '候補あり(2件)',
      tone: 'warn',
    });
    expect(memberMatchLabel({ status: 'none', points: 0, candidates: [] }, null)).toEqual({
      text: '該当なし',
      tone: 'muted',
    });
    expect(memberMatchLabel({ status: 'manual', points: 0, candidates: [] }, null)).toEqual({
      text: '確認済み(会員なし)',
      tone: 'muted',
    });
    expect(memberMatchLabel(null, null)).toEqual({ text: '未照合', tone: 'muted' });
  });
});

describe('matchedFieldsLabel', () => {
  it('一致した項目名を「・」でつなぐ(順序は氏名・電話・メール・住所)', () => {
    expect(matchedFieldsLabel(['email', 'name'])).toBe('氏名・メール');
    expect(matchedFieldsLabel([])).toBe('一致なし');
  });
});

describe('inquiryOverridesForMember', () => {
  // 「この会員に紐付け」のとき、問合せの値を会員の空欄に初期値として差し込む(2026-09-17)。
  // 既にある値は上書きしない(利用者がフォームで直せる)。メールと電話は空きの枠(email2/3、電話番号2/3)に追加する。
  const inquiry = {
    name_kana: 'テスト タロウ',
    email: 'New@Example.com',
    phone: '090-1234-5678',
    postal_code: '100-0001',
    address: '東京都千代田区1-1',
    ad_id: 'N0000003',
  };
  it('会員側が空の項目だけ埋める(既存の値は保持)', () => {
    const r = inquiryOverridesForMember(inquiry, {
      name_kana: null,
      email1: null,
      email2: null,
      email3: null,
      phone1: null,
      postal_code: '150-0000',
      address: null,
      ad_id: null,
      extra: null,
    });
    expect(r.columns).toEqual({
      name_kana: 'テスト タロウ',
      email1: 'new@example.com',
      phone1: '09012345678',
      address: '東京都千代田区1-1',
      ad_id: 'N0000003',
    });
    expect(r.extra).toEqual({});
  });
  it('メールは既存と同じなら何もせず、違えば空いている email2/3 に入れる', () => {
    const base = {
      name_kana: 'x',
      phone1: '1',
      postal_code: '1',
      address: 'a',
      ad_id: 'x',
      extra: null,
    };
    expect(
      inquiryOverridesForMember(inquiry, {
        ...base,
        email1: 'NEW@example.com',
        email2: null,
        email3: null,
      }).columns,
    ).toEqual({});
    expect(
      inquiryOverridesForMember(inquiry, { ...base, email1: 'a@x.jp', email2: null, email3: null })
        .columns,
    ).toEqual({ email2: 'new@example.com' });
    expect(
      inquiryOverridesForMember(inquiry, {
        ...base,
        email1: 'a@x.jp',
        email2: 'b@x.jp',
        email3: 'c@x.jp',
      }).columns,
    ).toEqual({});
  });
  it('電話は数字だけで比較し、違えば空いている 電話番号2/3(extra)に入れる', () => {
    const base = {
      name_kana: 'x',
      email1: 'new@example.com',
      email2: null,
      email3: null,
      postal_code: '1',
      address: 'a',
      ad_id: 'x',
    };
    expect(
      inquiryOverridesForMember(inquiry, { ...base, phone1: '09012345678', extra: null }),
    ).toEqual({ columns: {}, extra: {} });
    expect(
      inquiryOverridesForMember(inquiry, { ...base, phone1: '0312345678', extra: null }).extra,
    ).toEqual({ 電話番号2: '09012345678' });
    expect(
      inquiryOverridesForMember(inquiry, {
        ...base,
        phone1: '0312345678',
        extra: { 電話番号2: '090-1234-5678' },
      }).extra,
    ).toEqual({});
    expect(
      inquiryOverridesForMember(inquiry, {
        ...base,
        phone1: '0312345678',
        extra: { 電話番号2: '0311111111' },
      }).extra,
    ).toEqual({ 電話番号3: '09012345678' });
  });
  it('問合せ側が空の項目は何もしない', () => {
    const r = inquiryOverridesForMember(
      { name_kana: null, email: null, phone: null, postal_code: null, address: null, ad_id: null },
      {
        name_kana: null,
        email1: null,
        email2: null,
        email3: null,
        phone1: null,
        postal_code: null,
        address: null,
        ad_id: null,
        extra: null,
      },
    );
    expect(r).toEqual({ columns: {}, extra: {} });
  });
});
