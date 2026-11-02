import { describe, expect, it } from 'vitest';
import type { ApplicationListItem } from '../../lib/domain/applications';
import {
  applicationCsvHeaders,
  buildPaymentCsvFilename,
  toApplicationsCsv,
} from '../../lib/domain/applications_csv';
import type { FieldDefinition } from '../../lib/domain/object_metadata';

/**
 * 申込の CSV(サマリの入金一覧の CSV 出力。CLAUDE.md §8.1 `/summary`)。
 * 列は画面の申込一覧と同じ(項目管理の「一覧」表示 ON の項目)。値も画面と同じ見え方にするが、
 * 金額は Excel で計算できるよう数字だけにし、会員は突合に使えるよう 会員ID と 会員名 に分ける。
 * 名前・金額は架空。
 */
const f = (field_name: string, label: string, data_type = 'text', is_in_db = true) =>
  ({
    id: field_name,
    field_name,
    label,
    data_type,
    is_in_db,
    csv_column_name: null,
  }) as unknown as FieldDefinition;

const FIELDS = [
  f('id', '申込ID'),
  f('project_id', '案件'),
  f('acquirer_id', '申込獲得者'),
  f('member_id', '会員'),
  f('status', 'ステータス'),
  f('payment_date', '入金日', 'date'),
  f('payment_amount', '入金額', 'number'),
  f('interest', '利息', 'number'),
  f('start_datetime', '起算日', 'date'),
  f('contract_period', '契約期間'),
  f('備考', '備考', 'text', false),
];

const row = (over: Partial<ApplicationListItem> = {}): ApplicationListItem =>
  ({
    id: 'M-001000001',
    member_id: 'K-000100001',
    project_id: 'T-000000001',
    status: '入金',
    payment_date: '2026-10-30',
    payment_amount: 1000000,
    interest: 30,
    start_datetime: '2026-10-30T15:00:00+00:00',
    contract_period: '3',
    acquirer_id: 'u1',
    acquirer_name_raw: null,
    owner_name_raw: null,
    extra: { 備考: 'テスト, "引用"\n2行目' },
    member: { id: 'K-000100001', name: '架空 太郎' },
    project: { id: 'T-000000001', name: '架空案件' },
    acquirer: { id: 'u1', full_name: '担当 花子' },
    owner: null,
    ...over,
  }) as unknown as ApplicationListItem;

describe('applicationCsvHeaders', () => {
  it('列名は項目管理の表示名。会員だけは 会員ID と 会員名 の 2 列', () => {
    expect(applicationCsvHeaders(FIELDS)).toEqual([
      '申込ID',
      '案件',
      '申込獲得者',
      '会員ID',
      '会員名',
      'ステータス',
      '入金日',
      '入金額',
      '利息',
      '起算日',
      '契約期間',
      '備考',
    ]);
  });
});

describe('toApplicationsCsv', () => {
  it('BOM 付き・CRLF。値は画面と同じ見え方(名前・日付・単位)、金額は数字だけ', () => {
    const csv = toApplicationsCsv([row()], FIELDS);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(
      '申込ID,案件,申込獲得者,会員ID,会員名,ステータス,入金日,入金額,利息,起算日,契約期間,備考',
    );
    // 起算日は日本時間の日付(UTC 15:00 = 翌日 0:00)。備考はカンマ・引用符・改行を含むので囲む
    expect(lines.slice(1).join('\r\n')).toBe(
      'M-001000001,架空案件,担当 花子,K-000100001,架空 太郎,入金,2026/10/30,1000000,30%,2026/10/31,3ヶ月,"テスト, ""引用""\n2行目"\r\n',
    );
  });

  it('空の値は空欄(画面の「-」は出さない)。名前が引けなければ原文、それも無ければ空', () => {
    const csv = toApplicationsCsv(
      [
        row({
          payment_amount: null,
          start_datetime: null,
          contract_period: null,
          acquirer: null,
          acquirer_name_raw: '旧 担当',
          member: null,
          project: null,
          extra: {},
        } as unknown as Partial<ApplicationListItem>),
      ],
      FIELDS,
    );
    const data = csv.slice(1).split('\r\n')[1];
    expect(data).toBe('M-001000001,,旧 担当,K-000100001,,入金,2026/10/30,,30%,,,');
  });
});

describe('buildPaymentCsvFilename', () => {
  const now = new Date('2026-11-02T03:00:00Z');
  it('期間があれば ファイル名に入れる', () => {
    expect(buildPaymentCsvFilename({ from: '2026-10-01', to: '2026-10-31' }, now)).toBe(
      '入金一覧_20261001-20261031_20261102.csv',
    );
  });
  it('全期間なら作成日だけ', () => {
    expect(buildPaymentCsvFilename({ from: null, to: null }, now)).toBe('入金一覧_20261102.csv');
  });
});
