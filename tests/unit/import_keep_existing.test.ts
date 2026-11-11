import { describe, expect, it } from 'vitest';
import { classifyRecords } from '../../lib/import/diff';
import { type InquiryRecord, mergeInquiryWithExisting } from '../../lib/import/inquiries';
import { mergeMemberExtra } from '../../lib/import/members_map';
import { convertUserRow } from '../../lib/import/users_map';

/**
 * 取込が CRM 側で入れた値を消さないことの確認(2026-11-11)。
 * 方針: CSV に列が無い項目・CSV の値が空の項目は既存の値を残す。CSV に値があればそれで上書きする。
 */

const inquiry = (over: Partial<InquiryRecord> = {}): InquiryRecord => ({
  id: 'TA-000000001',
  form_id: 3,
  member_id: null,
  name: 'テスト 太郎',
  name_kana: null,
  email: 'test@example.com',
  phone: null,
  postal_code: null,
  address: null,
  ad_id: null,
  extra: {},
  registered_at: '2026-09-15T10:00:00+09:00',
  ...over,
});

describe('mergeInquiryWithExisting(問合せの取込)', () => {
  const existing = {
    id: 'TA-000000001',
    form_id: 3,
    member_id: 'K-000100001', // CRM で会員化した紐付け(Salesforce は知らない)
    name: 'テスト 太郎',
    name_kana: 'てすと たろう',
    email: 'test@example.com',
    phone: '09000000000', // CRM の編集で入れた電話番号
    postal_code: null,
    address: null,
    ad_id: null,
    extra: { 備考: 'CRM で書いた備考', 流入元: 'LP', 古い項目: '残す' },
    registered_at: '2026-09-15T01:00:00+00:00',
  };

  it('CSV の会員ID が空なら CRM の紐付けを残す', () => {
    const out = mergeInquiryWithExisting(inquiry(), existing);
    expect(out.member_id).toBe('K-000100001');
  });

  it('CSV に会員ID があればそれを使う', () => {
    const out = mergeInquiryWithExisting(inquiry({ member_id: 'K-000000045' }), existing);
    expect(out.member_id).toBe('K-000000045');
  });

  it('CSV に列が無い項目・値が空の項目は既存の値を残す', () => {
    const out = mergeInquiryWithExisting(inquiry({ phone: null }), existing);
    expect(out.phone).toBe('09000000000'); // 列はあるが空
    expect(out.name_kana).toBe('てすと たろう'); // 列が無い
  });

  it('可変項目は CSV に値がある列だけ差し替え、ほかの既存の値は残す', () => {
    const out = mergeInquiryWithExisting(
      inquiry({ extra: { 流入元: '広告' } }), // 備考は空
      existing,
    );
    expect(out.extra).toEqual({ 備考: 'CRM で書いた備考', 流入元: '広告', 古い項目: '残す' });
  });

  it('既存の行が無ければ CSV の値をそのまま使う', () => {
    const rec = inquiry({ extra: { 流入元: '広告' } });
    expect(mergeInquiryWithExisting(rec, undefined)).toEqual(rec);
  });
});

describe('mergeMemberExtra(会員の取込)', () => {
  const existing = {
    ASEC利用額: '5000000', // 申込から自動計算した値
    ASEC出金額: '100000',
    累計入金額: '5100000',
    電話番号2: '08011112222', // CRM の編集で入れた値
    古い項目: '残す',
    'C.I.Oシリーズ合計利用額': '10',
  };

  it('申込から自動計算する 利用額・出金額・累計入金額 は CSV の値で上書きしない', () => {
    const out = mergeMemberExtra(existing, { ASEC利用額: '1', ASEC出金額: '2', 累計入金額: '3' });
    expect(out.ASEC利用額).toBe('5000000');
    expect(out.ASEC出金額).toBe('100000');
    expect(out.累計入金額).toBe('5100000');
  });

  it('合計系(自動計算の対象外)は CSV の値で差し替える', () => {
    const out = mergeMemberExtra(existing, { 'C.I.Oシリーズ合計利用額': '20' });
    expect(out['C.I.Oシリーズ合計利用額']).toBe('20');
  });

  it('CSV の値が空の項目と、CSV に無い項目は既存の値を残す', () => {
    const out = mergeMemberExtra(existing, { 新しい項目: 'あり' });
    expect(out.電話番号2).toBe('08011112222');
    expect(out.古い項目).toBe('残す');
    expect(out.新しい項目).toBe('あり');
  });

  it('既存が無ければ自動計算の対象を除いて CSV の値を入れる', () => {
    const out = mergeMemberExtra(null, { ASEC利用額: '1', 電話番号2: '0801' });
    expect(out).toEqual({ 電話番号2: '0801' });
  });
});

describe('convertUserRow(従業員の取込)', () => {
  const existingId = '11111111-1111-1111-1111-111111111111';
  const maps = {
    idByLegacy: new Map<string, string>(),
    idByEmail: new Map([['staff@example.com', existingId]]),
    existingById: new Map([
      [
        existingId,
        {
          legacy_sf_id: '0055i000ABC',
          first_name: '太郎',
          last_name: 'テスト',
          full_name: 'テスト 太郎',
          is_active: false,
          role: 'admin' as const,
        },
      ],
    ]),
  };

  it('権限の列が無い・空なら既存ユーザーのロールを変えない(viewer に落とさない)', () => {
    const noColumn = convertUserRow({ メール: 'staff@example.com' }, 1, maps);
    expect(noColumn.record?.role).toBe('admin');
    const empty = convertUserRow({ メール: 'staff@example.com', 権限: '' }, 1, maps);
    expect(empty.record?.role).toBe('admin');
  });

  it('解釈できないロール名なら既存のロールを変えない', () => {
    const out = convertUserRow({ メール: 'staff@example.com', 権限: '経理部' }, 1, maps);
    expect(out.record?.role).toBe('admin');
  });

  it('support を読める', () => {
    const out = convertUserRow({ メール: 'staff@example.com', 権限: 'support' }, 1, maps);
    expect(out.record?.role).toBe('support');
    const jp = convertUserRow({ メール: 'staff@example.com', 権限: 'サポート' }, 1, maps);
    expect(jp.record?.role).toBe('support');
  });

  it('CSV に無い項目(有効・旧ID・氏名)は既存の値を残す', () => {
    const out = convertUserRow({ メール: 'staff@example.com' }, 1, maps);
    expect(out.record).toMatchObject({
      id: existingId,
      legacy_sf_id: '0055i000ABC',
      full_name: 'テスト 太郎',
      is_active: false,
    });
  });

  it('新しいユーザーは、ロールが読めなければ viewer・有効で作る', () => {
    const out = convertUserRow({ メール: 'new@example.com', 権限: '' }, 1, maps);
    expect(out.existed).toBe(false);
    expect(out.record).toMatchObject({ role: 'viewer', is_active: true });
  });
});

describe('classifyRecords(書き込む列を塊の中でそろえる)', () => {
  // 意図: upsert は塊の全行の列の和集合で書き込み、ある行に無い列は NULL になる。
  // 申込日のある行とない行が同じ塊に入ると、ない行の既存の申込日が消えていた
  it('列が欠けた既存行には、既存の値を入れてから書き込む', () => {
    const existing = new Map<string, Record<string, unknown>>([
      ['M-1', { id: 'M-1', application_date: '2026-01-05', payment_amount: 100 }],
    ]);
    const records: Array<Record<string, unknown>> = [
      { id: 'M-1', payment_amount: 200 }, // 申込日が空の行(キーを持たない)
      { id: 'M-2', application_date: '2026-02-01', payment_amount: 300 }, // 新規
    ];
    const { toUpsert } = classifyRecords(records, (r) => String(r.id), existing);
    expect(toUpsert.find((r) => r.id === 'M-1')).toEqual({
      id: 'M-1',
      application_date: '2026-01-05',
      payment_amount: 200,
    });
  });

  it('新規の行は欠けた列を補わない(既存値が無いため)', () => {
    const records: Array<Record<string, unknown>> = [
      { id: 'M-2', application_date: '2026-02-01' },
      { id: 'M-3' },
    ];
    const { toUpsert } = classifyRecords(records, (r) => String(r.id), new Map());
    expect(toUpsert.find((r) => r.id === 'M-3')).toEqual({ id: 'M-3' });
  });
});
