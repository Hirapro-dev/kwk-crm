import {
  parseAppStatusFilterParam,
  parseProjectFilterParam,
} from '@/lib/domain/application_list_filter';
import { describe, expect, it } from 'vitest';

/**
 * 申込の絞り込み条件の解釈(2026-10-16)。
 * 意図: 案件ID は T- 形式の文字列なので、数値に直さずそのまま絞り込みに使う。
 * ステータスは過去の値(完了・未購入・失効)でも絞り込めること。
 */
describe('parseProjectFilterParam', () => {
  it('T- 形式の案件ID はそのまま返す(以前は NaN になり絞り込みが外れていた)', () => {
    expect(parseProjectFilterParam('T-000000003')).toBe('T-000000003');
    expect(parseProjectFilterParam(' T-001000000 ')).toBe('T-001000000');
  });
  it('数字だけの ID も文字列のまま返す', () => {
    expect(parseProjectFilterParam('12')).toBe('12');
  });
  it('空・all・未指定は null(案件で絞らない)', () => {
    expect(parseProjectFilterParam('')).toBeNull();
    expect(parseProjectFilterParam('all')).toBeNull();
    expect(parseProjectFilterParam(undefined)).toBeNull();
    expect(parseProjectFilterParam(null)).toBeNull();
  });
  it('案件ID の形でない値は null(PostgREST の条件に混ぜない)', () => {
    expect(parseProjectFilterParam('T-1,status.eq.入金')).toBeNull();
    expect(parseProjectFilterParam('案件A')).toBeNull();
    expect(parseProjectFilterParam('x'.repeat(65))).toBeNull();
  });
});

describe('parseAppStatusFilterParam', () => {
  it('今の選択肢(対応中・入金・出金・資金移動)を受け付ける', () => {
    expect(parseAppStatusFilterParam('対応中')).toBe('対応中');
    expect(parseAppStatusFilterParam('資金移動')).toBe('資金移動');
  });
  it('過去の値(完了・未購入・失効)も受け付ける(以前は絞り込みが外れていた)', () => {
    expect(parseAppStatusFilterParam('完了')).toBe('完了');
    expect(parseAppStatusFilterParam('未購入')).toBe('未購入');
    expect(parseAppStatusFilterParam('失効')).toBe('失効');
  });
  it('一覧に無い値・空は undefined(ステータスで絞らない)', () => {
    expect(parseAppStatusFilterParam('キャンセル')).toBeUndefined();
    expect(parseAppStatusFilterParam('')).toBeUndefined();
    expect(parseAppStatusFilterParam(undefined)).toBeUndefined();
  });
});
