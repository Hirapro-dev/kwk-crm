import { describe, expect, it } from 'vitest';
import {
  type MailImportRule,
  applyRule,
  findMatchingRule,
  htmlToText,
  normalizeFieldMap,
  parseJstDateTime,
  parseMailBody,
  resolveFormName,
  ruleMatches,
  subjectWithoutName,
} from '../../lib/domain/mail_import_rules';

/**
 * メール取込ルール(CLAUDE.md §5.16)。フォーム通知メールから問合せの項目を
 * 決定論的に切り出す。実際のメール(未来予測分析レポート請求)を見本にする。
 */
const SUBJECT =
  '【Google広告経由】【未来予測分析レポート請求】本人確認完了 オオシマ 様（キオクシアホールディングス）';
const BODY = [
  '【未来予測分析レポート請求】本人確認完了（kioxia）【Google広告経由】',
  '',
  '完了日時: 2026/9/15 9:42:03',
  '対象銘柄: キオクシアホールディングス（kioxia）',
  'お名前: オオシマ',
  'メールアドレス: OMC41s@yahoo.co.jp',
  '電話番号: 090-3579-5121',
  '流入元: Google広告',
].join('\n');

function rule(over: Partial<MailImportRule> = {}): MailImportRule {
  return {
    id: 1,
    name: '未来予測・本人確認完了',
    is_active: true,
    sort_order: 100,
    mail_box_id: null,
    from_address: null,
    subject_contains: '【未来予測分析レポート請求】本人確認完了',
    form_name_source: 'body_line',
    form_name_param: '1',
    field_map: {
      お名前: 'name',
      メールアドレス: 'email',
      電話番号: 'phone',
      完了日時: 'registered_at',
      対象銘柄: 'extra:対象銘柄',
      流入元: 'extra:流入元',
    },
    ...over,
  };
}

describe('parseMailBody', () => {
  it('空行を除いた行と「ラベル: 値」の辞書にする(全角コロンも区切り)', () => {
    const p = parseMailBody(BODY, null);
    expect(p.lines[0]).toBe('【未来予測分析レポート請求】本人確認完了（kioxia）【Google広告経由】');
    expect(p.lines).toHaveLength(7);
    expect(p.labels.お名前).toBe('オオシマ');
    expect(parseMailBody('氏名：山田 太郎', null).labels.氏名).toBe('山田 太郎');
  });

  it('テキスト本文が無ければ HTML をテキスト化して使う', () => {
    const p = parseMailBody(null, '<p>お名前: 山田</p><br>電話番号: 0311112222<div>&amp;</div>');
    expect(p.labels.お名前).toBe('山田');
    expect(p.labels.電話番号).toBe('0311112222');
  });

  it('同じラベルが複数あれば最初の値を使う', () => {
    expect(parseMailBody('お名前: A\nお名前: B', null).labels.お名前).toBe('A');
  });
});

describe('htmlToText', () => {
  it('タグを外し、改行系タグは改行にし、実体参照を戻す', () => {
    expect(htmlToText('<p>a&lt;b</p><p>c&nbsp;d</p>')).toBe('a<b\nc d');
  });
});

describe('subjectWithoutName', () => {
  it('「○○ 様」の部分を除く(氏名が2語でも)', () => {
    expect(subjectWithoutName(SUBJECT)).toBe(
      '【Google広告経由】【未来予測分析レポート請求】本人確認完了（キオクシアホールディングス）',
    );
    expect(
      subjectWithoutName('【未来予測分析レポート請求】本人確認完了 Shoji Murakami 様（ゴールド）'),
    ).toBe('【未来予測分析レポート請求】本人確認完了（ゴールド）');
  });
  it('「様」が無ければそのまま', () => {
    expect(subjectWithoutName('GPPイベント参加申込フォーム')).toBe('GPPイベント参加申込フォーム');
  });
});

describe('resolveFormName', () => {
  const parsed = parseMailBody(BODY, null);
  it('本文のN行目(空行は数えない)', () => {
    expect(resolveFormName(rule(), SUBJECT, parsed)).toBe(
      '【未来予測分析レポート請求】本人確認完了（kioxia）【Google広告経由】',
    );
    expect(resolveFormName(rule({ form_name_param: '99' }), SUBJECT, parsed)).toBeNull();
  });
  it('本文のラベルの値 / 件名 / 件名から氏名除去 / 固定', () => {
    expect(
      resolveFormName(
        rule({ form_name_source: 'body_label', form_name_param: '対象銘柄' }),
        SUBJECT,
        parsed,
      ),
    ).toBe('キオクシアホールディングス（kioxia）');
    expect(resolveFormName(rule({ form_name_source: 'subject' }), SUBJECT, parsed)).toBe(SUBJECT);
    expect(
      resolveFormName(rule({ form_name_source: 'subject_without_name' }), SUBJECT, parsed),
    ).toBe(
      '【Google広告経由】【未来予測分析レポート請求】本人確認完了（キオクシアホールディングス）',
    );
    expect(
      resolveFormName(
        rule({ form_name_source: 'fixed', form_name_param: '固定名' }),
        SUBJECT,
        parsed,
      ),
    ).toBe('固定名');
    expect(
      resolveFormName(
        rule({ form_name_source: 'body_label', form_name_param: '無いラベル' }),
        SUBJECT,
        parsed,
      ),
    ).toBeNull();
  });
});

describe('parseJstDateTime', () => {
  it('「2026/9/15 9:42:03」を日本時間として ISO にする', () => {
    expect(parseJstDateTime('2026/9/15 9:42:03')).toBe('2026-09-15T00:42:03.000Z');
    expect(parseJstDateTime('2026-09-15 09:42')).toBe('2026-09-15T00:42:00.000Z');
    expect(parseJstDateTime('2026/09/15')).toBe('2026-09-14T15:00:00.000Z');
  });
  it('解釈できなければ null', () => {
    expect(parseJstDateTime('昨日')).toBeNull();
    expect(parseJstDateTime('')).toBeNull();
  });
});

describe('applyRule', () => {
  it('見本メールから問合せの項目を切り出す(電話は数字のみ・メールは小文字・日時は ISO)', () => {
    const r = applyRule(rule(), { subject: SUBJECT, textBody: BODY, htmlBody: null });
    expect(r.formName).toBe('【未来予測分析レポート請求】本人確認完了（kioxia）【Google広告経由】');
    expect(r.fields).toEqual({
      name: 'オオシマ',
      email: 'omc41s@yahoo.co.jp',
      phone: '09035795121',
    });
    expect(r.registeredAt).toBe('2026-09-15T00:42:03.000Z');
    expect(r.extra).toEqual({
      対象銘柄: 'キオクシアホールディングス（kioxia）',
      流入元: 'Google広告',
    });
    expect(r.errors).toEqual([]);
  });

  it('フォーム名が取れない・日時が読めない場合はエラーとして返す(勝手に補わない)', () => {
    const r = applyRule(rule({ form_name_param: '99' }), {
      subject: SUBJECT,
      textBody: '完了日時: 不明\nお名前: A',
      htmlBody: null,
    });
    expect(r.formName).toBeNull();
    expect(r.registeredAt).toBeNull();
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('本文に無いラベルは無視し、あるものだけ入れる', () => {
    const r = applyRule(rule(), { subject: SUBJECT, textBody: 'お名前: B', htmlBody: null });
    expect(r.fields).toEqual({ name: 'B' });
    expect(r.extra).toEqual({});
  });
});

describe('normalizeFieldMap', () => {
  it('許可された項目だけ残す(不正な項目名・空ラベルは捨てる)', () => {
    expect(
      normalizeFieldMap({
        お名前: 'name',
        危険: 'id',
        銘柄: 'extra:対象銘柄',
        '': 'email',
        x: 'extra:',
      }),
    ).toEqual({ お名前: 'name', 銘柄: 'extra:対象銘柄' });
    expect(normalizeFieldMap(null)).toEqual({});
  });
});

describe('ruleMatches / findMatchingRule', () => {
  const msg = { mailBoxId: 60, fromAddress: 'NoReply@kawaraban.co.jp', subject: SUBJECT };
  it('受信箱・差出人(大小文字無視)・件名含有がすべて一致したときだけ一致する', () => {
    expect(ruleMatches(rule(), msg)).toBe(true);
    expect(
      ruleMatches(rule({ mail_box_id: 60, from_address: 'noreply@kawaraban.co.jp' }), msg),
    ).toBe(true);
    expect(ruleMatches(rule({ mail_box_id: 61 }), msg)).toBe(false);
    expect(ruleMatches(rule({ from_address: 'other@example.com' }), msg)).toBe(false);
    expect(ruleMatches(rule({ subject_contains: '受信データ' }), msg)).toBe(false);
    expect(ruleMatches(rule({ is_active: false }), msg)).toBe(false);
  });
  it('判定順(sort_order → id)で最初に一致したルールを返す', () => {
    const a = rule({ id: 1, sort_order: 200, name: 'a' });
    const b = rule({ id: 2, sort_order: 100, name: 'b' });
    expect(findMatchingRule([a, b], msg)?.name).toBe('b');
    expect(findMatchingRule([rule({ subject_contains: 'なし' })], msg)).toBeNull();
  });
});
