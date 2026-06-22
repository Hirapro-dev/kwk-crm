import { describe, expect, it } from 'vitest';
import {
  buildInquiryExtra,
  cleanInquiryValue,
  convertInquiryRow,
} from '../../lib/import/inquiries';

/**
 * 問合せ専用取込の変換ロジック検証(CLAUDE.md §5.3 / §6)
 * 意図: 共通列→カラム / それ以外→extra / #### 除去 / フォーム・会員の非破壊解決 / TA-検証
 */

const baseRow: Record<string, string> = {
  問合せID: 'TA-000000123',
  会員ID: 'K-000000045',
  フォーム名: '【特別レポート申込】本人確認完了（BTC）',
  氏名: '山田太郎',
  氏名かな: 'やまだたろう',
  メールアドレス: 'taro@example.com',
  電話番号: '09012345678',
  郵便番号: '1000001',
  住所: '東京都千代田区',
  広告ID: 'AD-1',
  登録日時: '2024/7/24 22:06',
  // フォーム固有(→ extra 行き)
  投資中の金額: '5000000',
  紛失仮想通貨種類: 'ADA',
  機密埋め: '#########',
};

const formMap = new Map<string, number>([
  ['【特別レポート申込】本人確認完了（BTC）', 7],
]);
const validMembers = new Set<string>(['K-000000045']);

describe('cleanInquiryValue', () => {
  it('#### 連続は null、空白trim、空は null', () => {
    expect(cleanInquiryValue('#########')).toBeNull();
    expect(cleanInquiryValue('  ')).toBeNull();
    expect(cleanInquiryValue(' abc ')).toBe('abc');
  });
});

describe('buildInquiryExtra', () => {
  it('共通列以外のみを格納し、#### はスキップ', () => {
    const extra = buildInquiryExtra(baseRow);
    expect(extra['投資中の金額']).toBe('5000000');
    expect(extra['紛失仮想通貨種類']).toBe('ADA');
    expect(extra['機密埋め']).toBeUndefined(); // #### は除外
    expect(extra['氏名']).toBeUndefined(); // 共通列はextraに入れない
    expect(extra['問合せID']).toBeUndefined();
  });
});

describe('convertInquiryRow', () => {
  it('共通列をカラムにマップし、フォーム名と会員IDを解決する', () => {
    const out = convertInquiryRow(baseRow, 1, { formNameToId: formMap, validMemberIds: validMembers });
    expect(out.error).toBeUndefined();
    const r = out.record!;
    expect(r.id).toBe('TA-000000123');
    expect(r.form_id).toBe(7);
    expect(r.member_id).toBe('K-000000045');
    expect(r.name).toBe('山田太郎');
    expect(r.email).toBe('taro@example.com');
    expect(r.registered_at.startsWith('2024-07-24T22:06')).toBe(true);
    expect(r.extra['投資中の金額']).toBe('5000000');
  });

  it('未登録フォーム名は form_id=null だが formName を返す(commit時に新規作成)', () => {
    const out = convertInquiryRow(
      { ...baseRow, フォーム名: '新フォーム' },
      1,
      { formNameToId: formMap, validMemberIds: validMembers },
    );
    expect(out.record!.form_id).toBeNull();
    expect(out.formName).toBe('新フォーム');
  });

  it('存在しない会員IDは member_id=null(FK安全)', () => {
    const out = convertInquiryRow(
      { ...baseRow, 会員ID: 'K-999999999' },
      1,
      { formNameToId: formMap, validMemberIds: validMembers },
    );
    expect(out.record!.member_id).toBeNull();
  });

  it('問合せID が TA- 形式でなければエラー', () => {
    const out = convertInquiryRow(
      { ...baseRow, 問合せID: 'X-1' },
      3,
      { formNameToId: formMap, validMemberIds: validMembers },
    );
    expect(out.record).toBeUndefined();
    expect(out.error).toContain('問合せID');
  });

  it('登録日時が空ならエラー(NOT NULL カラム保護)', () => {
    const out = convertInquiryRow(
      { ...baseRow, 登録日時: '' },
      4,
      { formNameToId: formMap, validMemberIds: validMembers },
    );
    expect(out.record).toBeUndefined();
    expect(out.error).toContain('登録日時');
  });
});
