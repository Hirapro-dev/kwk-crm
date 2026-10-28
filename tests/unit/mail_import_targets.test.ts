import { describe, expect, it } from 'vitest';
import {
  FORM_TARGET,
  buildTargetOptions,
  filterTargetOptions,
  newExtraFieldKeys,
  targetLabel,
} from '../../lib/domain/mail_import_targets';

/**
 * 取込ルールの「入れる項目」の選択肢(CLAUDE.md §5.16)。
 * 問合せの可変項目が 289 件あるため、文字で絞り込めるセレクトにする。絞り込みは純粋関数で固定する。
 */
const fields = [
  { field_name: 'form_id', label: 'フォーム', is_in_db: true },
  { field_name: 'name', label: '氏名', is_in_db: true },
  { field_name: 'email', label: 'メール', is_in_db: true },
  { field_name: '対象銘柄', label: '対象銘柄', is_in_db: false },
  { field_name: '銘柄詳細', label: '銘柄詳細', is_in_db: false },
  { field_name: '年収', label: '年収', is_in_db: false },
];

describe('buildTargetOptions / targetLabel', () => {
  const options = buildTargetOptions(fields);
  it('フォーム(form_id)の表示名、DB 列(項目管理のラベル優先)、可変項目を組み立てる', () => {
    expect(options.formLabel).toBe('フォーム');
    expect(options.columns.find((c) => c.value === 'name')?.label).toBe('氏名');
    expect(options.columns.find((c) => c.value === 'phone')?.label).toBe('電話');
    expect(options.extras.map((e) => e.value)).toEqual([
      'extra:対象銘柄',
      'extra:銘柄詳細',
      'extra:年収',
    ]);
    expect(targetLabel(options, FORM_TARGET)).toBe('フォーム');
    expect(targetLabel(options, 'extra:銘柄詳細')).toBe('銘柄詳細');
    expect(targetLabel(options, 'extra:新しい項目')).toBe('新しい項目(新規)');
  });
});

describe('filterTargetOptions', () => {
  const options = buildTargetOptions(fields);
  it('空の検索語ならすべて(フォーム / 問合せの項目 / 可変項目 / 新規)を返す', () => {
    const r = filterTargetOptions(options, '', 'IPアドレス');
    expect(r.form?.label).toBe('フォーム');
    expect(r.columns.length).toBe(options.columns.length);
    expect(r.extras.length).toBe(3);
    expect(r.newExtra).toEqual({ value: 'extra:IPアドレス', label: 'IPアドレス' });
  });
  it('検索語を含む項目だけに絞る(表示名の部分一致。大文字小文字・全角半角の違いは無視)', () => {
    const r = filterTargetOptions(options, '銘柄', 'IPアドレス');
    expect(r.form).toBeNull();
    expect(r.columns).toEqual([]);
    expect(r.extras.map((e) => e.label)).toEqual(['対象銘柄', '銘柄詳細']);
    expect(r.newExtra).toBeNull();
    expect(filterTargetOptions(options, 'ﾒｰﾙ', 'x').columns.map((c) => c.value)).toEqual(['email']);
    expect(filterTargetOptions(options, 'form', 'x').form).toBeNull();
    expect(filterTargetOptions(options, 'ふぉーむ', 'x').form).toBeNull();
    expect(filterTargetOptions(options, 'フォーム', 'x').form?.value).toBe(FORM_TARGET);
  });
  it('本文のラベルと同名の可変項目が定義済みなら「新規」は出さない。検索語がラベルに含まれるときだけ新規を出す', () => {
    expect(filterTargetOptions(options, '', '年収').newExtra).toBeNull();
    expect(filterTargetOptions(options, 'IP', 'IPアドレス').newExtra?.value).toBe(
      'extra:IPアドレス',
    );
    expect(filterTargetOptions(options, '住所', 'IPアドレス').newExtra).toBeNull();
  });
});

describe('newExtraFieldKeys(ルールの保存で項目管理に足す可変項目)', () => {
  // 意図: 「入れる項目」で「<キー>(新規)」を選んだまま保存すると、値は問合せの extra に入るのに
  // 項目管理(field_definitions)に無いため、オブジェクト管理にも問合せの詳細画面にも出なかった(2026-10-28)。
  // 保存のときに、まだ定義の無い可変項目を足す。
  it('項目管理に無い extra: のキーだけを、重複なく返す', () => {
    expect(
      newExtraFieldKeys(
        {
          お名前: 'name',
          ご相談項目: 'extra:ご相談項目',
          お問い合わせ内容: 'extra:詳細',
          ご相談項目2: 'extra:ご相談項目',
          流入元: 'extra:流入元',
        },
        ['詳細', '備考'],
      ),
    ).toEqual(['ご相談項目', '流入元']);
  });
  it('すべて定義済み・可変項目が無いときは空', () => {
    expect(newExtraFieldKeys({ お問い合わせ内容: 'extra:詳細' }, ['詳細'])).toEqual([]);
    expect(newExtraFieldKeys({ お名前: 'name' }, [])).toEqual([]);
  });
  it('キーの前後の空白は除き、空のキーは足さない', () => {
    expect(newExtraFieldKeys({ a: 'extra: 流入元 ', b: 'extra:' }, [])).toEqual(['流入元']);
  });
});
