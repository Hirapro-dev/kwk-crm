import { describe, expect, it } from 'vitest';
import { matchedFieldsLabel, memberMatchLabel } from '../../lib/domain/inquiry_lead';

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
