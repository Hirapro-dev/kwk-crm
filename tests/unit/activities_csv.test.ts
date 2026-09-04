import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_CSV_HEADERS,
  buildActivitiesCsvFilename,
  escapeCsvCell,
  toActivitiesCsv,
} from '../../lib/domain/activities_csv';
import type { ActivityListItem } from '../../lib/domain/types';

/**
 * 対応歴の「対応詳細」は自由入力で、実データにも「、」「,」や改行が普通に入る。
 * エスケープを1文字でも間違えると列がずれて CSV 全体が壊れるため、意図的に検証する。
 */

/** テスト用の最小の行を作る(実在の氏名は使わない: CLAUDE.md §15-6) */
function row(over: Partial<ActivityListItem> = {}): ActivityListItem {
  return {
    id: 1,
    registered_datetime: '2026-06-10T09:00:00+00:00',
    created_at: '2026-06-10T09:00:00+00:00',
    description: '通常のテキスト',
    d_bunrui: 'アウト（電話）',
    m_bunrui: null,
    s_bunrui: '通電',
    member_id: 'K-000000001',
    member: { id: 'K-000000001', name: 'テスト会員' },
    owner: { id: 'u1', full_name: 'テスト担当' },
    ...over,
  } as unknown as ActivityListItem;
}

describe('escapeCsvCell(仕様書 §9.11)', () => {
  it('特別な文字がなければそのまま出す', () => {
    expect(escapeCsvCell('通電')).toBe('通電');
  });

  it('カンマ・ダブルクォート・改行を含む値は囲む', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
    expect(escapeCsvCell('a\r\nb')).toBe('"a\r\nb"');
  });

  it('内部のダブルクォートは2つ重ねる(RFC 4180)', () => {
    expect(escapeCsvCell('彼は"了承"と言った')).toBe('"彼は""了承""と言った"');
  });

  it('null / undefined / 空文字は空セルにする', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
    expect(escapeCsvCell('')).toBe('');
  });

  it('日本語の読点「、」は囲まない(CSVの区切りではないため)', () => {
    expect(escapeCsvCell('説明、了承')).toBe('説明、了承');
  });
});

describe('toActivitiesCsv(仕様書 §8.1 / §9.11)', () => {
  it('BOM 付きで、1行目が画面と同じ並びのヘッダーになる', () => {
    const csv = toActivitiesCsv([]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).split('\r\n')[0]).toBe(ACTIVITY_CSV_HEADERS.join(','));
  });

  it('改行を含む対応詳細でも列がずれない', () => {
    const csv = toActivitiesCsv([row({ description: '1行目\n2行目, カンマあり' })]);
    const body = csv.slice(1).split('\r\n')[1];
    // 対応詳細だけが囲まれ、セル内改行は囲みの内側に収まる
    expect(body).toContain('"1行目\n2行目, カンマあり"');
    // 会員ID・会員名・対応者が正しい位置に出ている
    expect(body?.startsWith('2026/06/10 18:00,K-000000001,テスト会員,テスト担当,')).toBe(true);
  });

  it('日時は JST の YYYY/MM/DD HH:mm で出す', () => {
    // 09:00 UTC = 18:00 JST
    const csv = toActivitiesCsv([row()]);
    expect(csv).toContain('2026/06/10 18:00');
  });

  it('registered_datetime が無ければ created_at を使う(画面と同じ)', () => {
    const csv = toActivitiesCsv([
      row({ registered_datetime: null, created_at: '2026-01-05T01:30:00+00:00' }),
    ]);
    expect(csv).toContain('2026/01/05 10:30');
  });

  it('会員・対応者が未設定でも落ちず、空セルになる', () => {
    const csv = toActivitiesCsv([row({ member: null, owner: null, member_id: null })]);
    const body = csv.slice(1).split('\r\n')[1];
    expect(body?.startsWith('2026/06/10 18:00,,,,')).toBe(true);
  });

  it('行区切りは CRLF(セル内改行と区別できるようにする)', () => {
    const csv = toActivitiesCsv([row(), row()]);
    // ヘッダー + 2行 + 末尾改行
    expect(csv.split('\r\n')).toHaveLength(4);
  });
});

describe('buildActivitiesCsvFilename', () => {
  const now = new Date('2026-09-04T01:00:00+00:00'); // JST 2026/09/04 10:00

  it('期間指定なしなら出力日だけ', () => {
    expect(buildActivitiesCsvFilename({}, now)).toBe('対応歴_20260904.csv');
  });

  it('期間を指定すると開始-終了が入る(繋がって読めなくならない)', () => {
    expect(buildActivitiesCsvFilename({ from: '2026-01-01', to: '2026-01-31' }, now)).toBe(
      '対応歴_20260101-20260131_20260904.csv',
    );
  });

  it('片方だけの指定でも境界が分かる', () => {
    expect(buildActivitiesCsvFilename({ from: '2026-01-01' }, now)).toBe(
      '対応歴_20260101-終了不問_20260904.csv',
    );
    expect(buildActivitiesCsvFilename({ to: '2026-01-31' }, now)).toBe(
      '対応歴_開始不問-20260131_20260904.csv',
    );
  });
});
