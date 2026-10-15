/**
 * 日本時間の境目・入力値の変換(lib/utils/date.ts)と、レポート出力の日時整形のテスト。
 *
 * 本番(Vercel)はサーバーの時刻帯が UTC、利用者は日本。サーバーの時刻帯で
 * setHours / getHours / 時差なしの new Date() を使うと 9 時間ずれるため、
 * どの関数も実行環境の時刻帯に依存しないことを確かめる。
 * (TZ=UTC と TZ=Asia/Tokyo の両方で同じ結果になること。CI・手元の両方で意味を持つよう、
 *  期待値はすべて固定の UTC 時刻で書く)
 */

import type { ReportResult } from '@/lib/reports/execute_v2';
import { toCsv, toXlsx } from '@/lib/reports/export_v2';
import {
  formatJstDateTimeHm,
  jstDateRangeToIso,
  jstDayStartIso,
  jstInputToIso,
  jstMonthRangeYmd,
  jstMonthStartIso,
  toJstDateTimeLocal,
  toJstExcelSerial,
} from '@/lib/utils/date';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

describe('jstDayStartIso(ダッシュボードの「今日」の起点)', () => {
  it('日本時間 10/16 08:00(UTC では前日 23:00)でも、今日は日本時間 10/16 0:00 から', () => {
    // UTC の setHours(0) だと 10/15 0:00 UTC = 日本時間 10/15 9:00 になっていた
    expect(jstDayStartIso(new Date('2026-10-15T23:00:00Z'))).toBe('2026-10-15T15:00:00.000Z');
  });
  it('日本時間 10/16 23:30 でも今日は 10/16', () => {
    expect(jstDayStartIso(new Date('2026-10-16T14:30:00Z'))).toBe('2026-10-15T15:00:00.000Z');
  });
  it('日本時間 0:00 ちょうどはその日の始まり', () => {
    expect(jstDayStartIso(new Date('2026-10-15T15:00:00Z'))).toBe('2026-10-15T15:00:00.000Z');
  });
});

describe('jstMonthStartIso / jstMonthRangeYmd(ダッシュボードの「今月」)', () => {
  it('日本時間 11/1 08:00(UTC ではまだ 10/31)は 11 月として数える', () => {
    const now = new Date('2026-10-31T23:00:00Z');
    expect(jstMonthStartIso(now)).toBe('2026-10-31T15:00:00.000Z');
    expect(jstMonthRangeYmd(now)).toEqual({ from: '2026-11-01', toExclusive: '2026-12-01' });
  });
  it('年をまたぐ: 日本時間 12 月は翌年 1/1 まで', () => {
    expect(jstMonthRangeYmd(new Date('2026-12-15T03:00:00Z'))).toEqual({
      from: '2026-12-01',
      toExclusive: '2027-01-01',
    });
  });
  it('日本時間 1/1 07:00(UTC では前年 12/31)は 1 月', () => {
    expect(jstMonthStartIso(new Date('2026-12-31T22:00:00Z'))).toBe('2026-12-31T15:00:00.000Z');
  });
});

describe('jstDateRangeToIso(会員詳細の対応歴の期間絞り込み)', () => {
  it('開始日は日本時間 0:00、終了日は日本時間の終わりまで含める', () => {
    expect(jstDateRangeToIso('2026-10-01', '2026-10-15')).toEqual({
      from: '2026-09-30T15:00:00.000Z',
      to: '2026-10-15T14:59:59.999Z',
    });
  });
  it('月末・年末もはみ出さない', () => {
    expect(jstDateRangeToIso(null, '2026-12-31').to).toBe('2026-12-31T14:59:59.999Z');
  });
  it('空・不正な日付は条件にしない', () => {
    expect(jstDateRangeToIso('', undefined)).toEqual({});
    expect(jstDateRangeToIso('2026/10/01', 'abc')).toEqual({});
  });
});

describe('toJstDateTimeLocal(会員編集ダイアログの日時欄の表示)', () => {
  it('DB の UTC の値を日本時間の壁時計で入れる(以前は UTC のまま 9 時間前で表示していた)', () => {
    expect(toJstDateTimeLocal('2018-07-24T13:06:00+00:00')).toBe('2018-07-24T22:06');
  });
  it('日付をまたぐ', () => {
    expect(toJstDateTimeLocal('2026-10-15T20:00:00Z')).toBe('2026-10-16T05:00');
  });
  it('空・不正は空欄', () => {
    expect(toJstDateTimeLocal(null)).toBe('');
    expect(toJstDateTimeLocal('')).toBe('');
    expect(toJstDateTimeLocal('abc')).toBe('');
  });
});

describe('jstInputToIso(画面で入力した日時を保存する値へ)', () => {
  it('datetime-local の値は日本時間として解釈する(以前はサーバーで UTC として解釈し 9 時間ずれていた)', () => {
    expect(jstInputToIso('2026-10-16T10:00')).toBe('2026-10-16T01:00:00.000Z');
    expect(jstInputToIso('2026-10-16T10:00:30')).toBe('2026-10-16T01:00:30.000Z');
    expect(jstInputToIso('2026-10-16 10:00')).toBe('2026-10-16T01:00:00.000Z');
  });
  it('日付だけは日本時間のその日 0:00', () => {
    expect(jstInputToIso('2026-10-16')).toBe('2026-10-15T15:00:00.000Z');
  });
  it('時差付きの値はそのまま(既存の値の保存し直しでずれない)', () => {
    expect(jstInputToIso('2018-07-24T13:06:00+00:00')).toBe('2018-07-24T13:06:00.000Z');
    expect(jstInputToIso('2026-10-16T10:00:00Z')).toBe('2026-10-16T10:00:00.000Z');
    expect(jstInputToIso('2026-10-16T10:00:00+09:00')).toBe('2026-10-16T01:00:00.000Z');
  });
  it('表示 → 保存の往復で値が変わらない', () => {
    const db = '2018-07-24T13:06:00.000Z';
    expect(jstInputToIso(toJstDateTimeLocal(db))).toBe(db);
  });
  it('空は null、解釈できない値は undefined(呼び出し側でエラーにする)', () => {
    expect(jstInputToIso('')).toBeNull();
    expect(jstInputToIso(null)).toBeNull();
    expect(jstInputToIso('   ')).toBeNull();
    expect(jstInputToIso('abc')).toBeUndefined();
    expect(jstInputToIso('2026-13-40T10:00')).toBeUndefined();
  });
});

describe('formatJstDateTimeHm / toJstExcelSerial(レポートの CSV / Excel 出力)', () => {
  it('CSV の日時は日本時間 YYYY/MM/DD HH:mm', () => {
    expect(formatJstDateTimeHm('2026-10-15T13:06:00+00:00')).toBe('2026/10/15 22:06');
    expect(formatJstDateTimeHm('2026-10-15T15:00:00Z')).toBe('2026/10/16 00:00');
    expect(formatJstDateTimeHm('abc')).toBe('');
  });
  it('Excel のシリアル値は日本時間の壁時計', () => {
    // 2026-10-15 22:06(日本時間) = 46310 日 + 22:06
    expect(toJstExcelSerial('2026-10-15T13:06:00Z')).toBeCloseTo(46310 + (22 * 60 + 6) / 1440, 9);
    expect(toJstExcelSerial('abc')).toBeNull();
  });
});

describe('レポート出力(export_v2)', () => {
  const result = {
    columns: [
      { alias: 'c1', label: '登録日時' },
      { alias: 'c2', label: '申込日' },
      { alias: 'c3', label: '氏名' },
    ],
    rows: [{ c1: '2026-10-15T13:06:00+00:00', c2: '2026-10-15', c3: 'テスト 太郎' }],
  } as unknown as ReportResult;

  it('CSV の日時は日本時間で出す(以前はサーバーの時刻帯 = UTC で出していた)', () => {
    const csv = toCsv(result);
    expect(csv.split('\n')[1]).toBe('2026/10/15 22:06,2026/10/15,テスト 太郎');
  });

  it('Excel の日時セルは日本時間で、日時の表示書式が付く', () => {
    const wb = XLSX.read(toXlsx(result), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0] as string] as XLSX.WorkSheet;
    const a2 = ws.A2 as XLSX.CellObject;
    expect(a2.t).toBe('n');
    expect(a2.v as number).toBeCloseTo(46310 + (22 * 60 + 6) / 1440, 6);
    expect(XLSX.SSF.format('yyyy/mm/dd hh:mm', a2.v as number)).toBe('2026/10/15 22:06');
    expect((ws.B2 as XLSX.CellObject).v).toBe('2026-10-15');
  });
});
