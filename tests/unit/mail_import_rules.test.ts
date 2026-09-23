import { describe, expect, it } from 'vitest';
import {
  IMPORT_TARGETS,
  type MailImportRule,
  applyRule,
  findMatchingRule,
  guessFieldTarget,
  guessFormLabel,
  htmlToText,
  normalizeFieldMap,
  parseJstDateTime,
  parseMailBody,
  resolveFormName,
  ruleMatches,
  ruleMismatchReasons,
  subjectKeywords,
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
    body_contains: null,
    form_name_contains: null,
    target: 'inquiry',
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

  // 意図: 「銘柄詳細:」のように値が次の行以降に書かれる項目を、次の空行までまとめて 1 つの値にする
  // (未来予測レポート(リクエスト)の通知メール。2026-09-23)
  it('「ラベル:」だけの行は次の空行までをまとめて値にし、先頭の見出し行(▼)は除く', () => {
    const body = [
      '【未来予測レポート（リクエスト）】登録がありました',
      '',
      '回答日時: 2026/9/22 22:53:47',
      'お名前: 山田 太郎',
      'メールアドレス: a@example.com',
      '銘柄詳細:',
      '▼リクエストいただいた銘柄',
      '1. xels　保有数量: 1000',
      '2. asec　保有数量: 500',
      '',
      '※集計は管理画面で確認できます。',
    ].join('\n');
    const p = parseMailBody(body, null);
    expect(p.labels.銘柄詳細).toBe('1. xels　保有数量: 1000\n2. asec　保有数量: 500');
    // まとめた行は個別のラベル(「1. xels　保有数量」)としては出さない
    expect(p.labels['1. xels　保有数量']).toBeUndefined();
    expect(p.labels.お名前).toBe('山田 太郎');
    expect(p.labels.回答日時).toBe('2026/9/22 22:53:47');
  });

  it('「ラベル:」の後に行が無ければラベルにしない', () => {
    expect(parseMailBody('銘柄詳細:\n\n※以上', null).labels.銘柄詳細).toBeUndefined();
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
  it('氏名が「】」の直後に空白なしで続くときは、「】」までを残して氏名だけ除く', () => {
    // 実際の件名「【Google広告経由】【未来予測分析レポート請求】オオシマ 様（…）」で、
    // 先頭の語ごと落ちて「（キオクシアホールディングス）」だけになる不具合の再発防止(2026-09-15)
    expect(
      subjectWithoutName(
        '【Google広告経由】【未来予測分析レポート請求】オオシマ 様（キオクシアホールディングス）',
      ),
    ).toBe('【Google広告経由】【未来予測分析レポート請求】（キオクシアホールディングス）');
    expect(subjectWithoutName('【申込】山田 様')).toBe('【申込】');
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
  it('件名の条件は空白区切りのキーワードで、順序を問わずすべて含むときに一致する', () => {
    // 実際の件名は「【Google広告経由】【未来予測分析レポート請求】本人確認完了 …（キオクシア…）」のように
    // 本文1行目と語順が違うため、丸ごとの部分一致ではなくキーワードの AND で判定する
    expect(subjectKeywords('本人確認完了 Google広告経由　キオクシア')).toEqual([
      '本人確認完了',
      'Google広告経由',
      'キオクシア',
    ]);
    expect(subjectKeywords('  ')).toEqual([]);
    expect(subjectKeywords(null)).toEqual([]);
    expect(ruleMatches(rule({ subject_contains: '本人確認完了 Google広告経由' }), msg)).toBe(true);
    expect(ruleMatches(rule({ subject_contains: 'Google広告経由　キオクシア' }), msg)).toBe(true);
    expect(ruleMatches(rule({ subject_contains: '本人確認完了 kioxia' }), msg)).toBe(false);
    // 件名が無いメールはキーワード条件のあるルールに一致しない
    expect(ruleMatches(rule(), { ...msg, subject: null })).toBe(false);
  });
  it('本文キーワード(空白区切り・すべて含む)でも絞れる。本文が無いメールは一致しない', () => {
    // 「受信データ」と「本人確認完了」の区別は件名に無く本文1行目にしかないため(2026-09-15 追加, migration 90)
    const withBody = {
      ...msg,
      subject: '【Google広告経由】【未来予測分析レポート請求】オオシマ 様',
      textBody: BODY,
    };
    const base = { subject_contains: '【未来予測分析レポート請求】' };
    expect(ruleMatches(rule({ ...base, body_contains: '本人確認完了' }), withBody)).toBe(true);
    expect(ruleMatches(rule({ ...base, body_contains: '本人確認完了 kioxia' }), withBody)).toBe(
      true,
    );
    expect(ruleMatches(rule({ ...base, body_contains: '受信データ' }), withBody)).toBe(false);
    // 本文を渡さない・空のメールは、本文条件のあるルールに一致しない
    expect(ruleMatches(rule({ ...base, body_contains: '本人確認完了' }), msg)).toBe(false);
    expect(
      ruleMatches(rule({ ...base, body_contains: '本人確認完了' }), { ...withBody, textBody: '' }),
    ).toBe(false);
    // HTML しか無いメールはテキスト化して判定する
    expect(
      ruleMatches(rule({ ...base, body_contains: '本人確認完了' }), {
        ...msg,
        textBody: null,
        htmlBody: '<p>【未来予測分析レポート請求】本人確認完了（kioxia）</p>',
      }),
    ).toBe(true);
    // 本文条件が空(null / 空白)なら本文は見ない
    expect(ruleMatches(rule({ ...base, body_contains: '  ' }), msg)).toBe(true);
  });
  it('判定順(sort_order → id)で最初に一致したルールを返す', () => {
    const a = rule({ id: 1, sort_order: 200, name: 'a' });
    const b = rule({ id: 2, sort_order: 100, name: 'b' });
    expect(findMatchingRule([a, b], msg)?.name).toBe('b');
    expect(findMatchingRule([rule({ subject_contains: 'なし' })], msg)).toBeNull();
  });
});

describe('guessFieldTarget / guessFormLabel(新規ルールの初期割当て)', () => {
  const extras = new Set(['extra:年収']);
  it('ラベル名から問合せの項目を推定する。ふりがな・フリガナ・カナは氏名ではなく氏名(カナ)', () => {
    expect(guessFieldTarget('お名前(姓・名)', extras)).toBe('name');
    expect(guessFieldTarget('お名前ふりがな', extras)).toBe('name_kana');
    expect(guessFieldTarget('フリガナ', extras)).toBe('name_kana');
    expect(guessFieldTarget('氏名カナ', extras)).toBe('name_kana');
    expect(guessFieldTarget('メールアドレス', extras)).toBe('email');
    expect(guessFieldTarget('電話番号', extras)).toBe('phone');
    expect(guessFieldTarget('登録日時', extras)).toBe('registered_at');
    expect(guessFieldTarget('年収', extras)).toBe('extra:年収');
    expect(guessFieldTarget('IPアドレス', extras)).toBe('');
  });
  it('本文に「フォーム名」「フォーム」のラベルがあれば、それをフォーム名の取り元にする', () => {
    expect(guessFormLabel(['登録日時', 'フォームID', 'フォーム名', 'お名前'])).toBe('フォーム名');
    expect(guessFormLabel(['フォーム', 'お名前'])).toBe('フォーム');
    // 「フォームID」だけではフォーム名にしない
    expect(guessFormLabel(['フォームID', 'お名前'])).toBeNull();
    expect(guessFormLabel([])).toBeNull();
  });
});

describe('取込先(target)とフォーム名キーワード(form_name_contains)', () => {
  // LP・メルマガ系のフォーム通知は問合せではなく LP(lp_entries)に入れる(§5.16 / §5.17。migration 99)。
  // 「フォーム名に○○を含むフォームは LP へ」をルールで表せるよう、フォーム名に対するキーワード条件を持つ。
  const EXPA_BODY = [
    '登録日時: 2026/09/16 10:00:00',
    'フォームID: 123',
    'フォーム名: 【FB広告】【KAWARA版】１・仮想通貨レスキューサービスLP',
    'メールアドレス: test@example.com',
    'お名前(姓・名): テスト 太郎',
  ].join('\n');
  const msg = {
    mailBoxId: 60,
    fromAddress: 'noreply@example.com',
    subject: '[エキスパ]フォーム登録通知',
    textBody: EXPA_BODY,
  };
  const lpRule = (over: Partial<MailImportRule> = {}) =>
    rule({
      subject_contains: '[エキスパ]フォーム登録通知',
      form_name_source: 'body_label',
      form_name_param: 'フォーム名',
      target: 'lp',
      ...over,
    });
  it('取込先は問合せ / LP の2種類', () => {
    expect(IMPORT_TARGETS).toEqual(['inquiry', 'lp']);
  });
  it('フォーム名キーワードは、ルールの取り方で決めたフォーム名に対して判定する(すべて含む・語順不問)', () => {
    expect(ruleMatches(lpRule({ form_name_contains: 'LP' }), msg)).toBe(true);
    expect(ruleMatches(lpRule({ form_name_contains: 'KAWARA版 LP' }), msg)).toBe(true);
    expect(ruleMatches(lpRule({ form_name_contains: 'メールマガジン' }), msg)).toBe(false);
    // 本文の他の場所に語があってもフォーム名に無ければ一致しない(本文キーワードとの違い)
    expect(
      ruleMatches(lpRule({ form_name_contains: 'example' }), {
        ...msg,
        textBody: `${EXPA_BODY}\n参照元: https://example.com/LP`,
      }),
    ).toBe(false);
    // フォーム名が取れないメールは、フォーム名キーワード条件のあるルールに一致しない
    expect(ruleMatches(lpRule({ form_name_contains: 'LP' }), { ...msg, textBody: null })).toBe(
      false,
    );
    // 条件が空ならフォーム名では絞らない
    expect(ruleMatches(lpRule({ form_name_contains: '  ' }), msg)).toBe(true);
  });
  it('判定順で LP ルールを先に置けば、同じメールに一致する問合せルールより優先される', () => {
    const inquiryRule = rule({
      id: 11,
      sort_order: 100,
      subject_contains: '[エキスパ]フォーム登録通知',
      body_contains: 'KAWARA版',
      form_name_source: 'body_label',
      form_name_param: 'フォーム名',
    });
    const lp = lpRule({ id: 20, sort_order: 10, form_name_contains: 'LP' });
    expect(findMatchingRule([inquiryRule, lp], msg)?.id).toBe(20);
    expect(
      findMatchingRule(
        [inquiryRule, lpRule({ id: 20, sort_order: 10, form_name_contains: 'メールマガジン' })],
        msg,
      )?.id,
    ).toBe(11);
  });
});

describe('ruleMismatchReasons', () => {
  // 取込候補で「未設定」のメールに既存ルールを手で当てはめるとき、そのルールに一致しなかった理由を
  // 注釈として出す(ルールを直す手がかり。2026-09-17)。判定は ruleMatches と同じ条件を1つずつ見る
  const msg = {
    mailBoxId: 60,
    fromAddress: 'noreply@kawaraban.co.jp',
    subject: SUBJECT,
    textBody: BODY,
  };
  it('一致するルールは理由なし(空配列)', () => {
    expect(ruleMismatchReasons(rule(), msg)).toEqual([]);
  });
  it('受信箱・差出人・件名キーワード・本文キーワード・フォーム名キーワード・無効 を個別に説明する', () => {
    expect(ruleMismatchReasons(rule({ mail_box_id: 61 }), msg)).toEqual([
      '受信箱が違う(ルールは受信箱 #61 限定)',
    ]);
    expect(ruleMismatchReasons(rule({ from_address: 'other@example.com' }), msg)).toEqual([
      '差出人が違う(ルールは other@example.com 限定)',
    ]);
    expect(ruleMismatchReasons(rule({ subject_contains: '本人確認完了 受信データ' }), msg)).toEqual(
      ['件名にキーワード「受信データ」を含まない'],
    );
    expect(ruleMismatchReasons(rule({ body_contains: 'メールマガジン LP' }), msg)).toEqual([
      '本文にキーワード「メールマガジン」「LP」を含まない',
    ]);
    expect(
      ruleMismatchReasons(
        rule({ form_name_source: 'body_line', form_name_param: '1', form_name_contains: 'LP' }),
        msg,
      ),
    ).toEqual([
      'フォーム名「【未来予測分析レポート請求】本人確認完了（kioxia）【Google広告経由】」にキーワード「LP」を含まない',
    ]);
    expect(
      ruleMismatchReasons(
        rule({
          form_name_source: 'body_label',
          form_name_param: 'フォーム名',
          form_name_contains: 'LP',
        }),
        msg,
      ),
    ).toEqual(['フォーム名を取得できない(ルールの取り方: 本文のラベルの値「フォーム名」)']);
    expect(ruleMismatchReasons(rule({ is_active: false }), msg)).toEqual([
      'ルールが無効になっている',
    ]);
  });
  it('複数の条件に外れていれば理由を全部並べる', () => {
    expect(
      ruleMismatchReasons(rule({ mail_box_id: 61, subject_contains: 'メールマガジン' }), msg),
    ).toEqual([
      '受信箱が違う(ルールは受信箱 #61 限定)',
      '件名にキーワード「メールマガジン」を含まない',
    ]);
  });
});
