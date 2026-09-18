import {
  type AppResolveMaps,
  convertApplicationRow,
  mergeApplicationExtra,
} from '@/lib/import/applications_map';
import { describe, expect, it } from 'vitest';

/**
 * 申込 CSV の行変換(CLAUDE.md §5.6 / §6)。
 * 2026-09-18: Salesforce の申込一覧 CSV は書き出す列の組が時期で違うため、
 * 「CSV に無い列は触らない(既存値を保つ)」ことをテストで固定する。
 * 以前は 入金/移動 の列が無い CSV を取り込むと flow_type が NULL で上書きされ、
 * extra も CSV にある列だけに置き換わって既存の可変項目が消える恐れがあった。
 */

const maps: AppResolveMaps = {
  projectNameToId: new Map([['ASECコイン', '7']]),
  validMemberIds: new Set(['K-000000001']),
  validInquiryIds: new Set(),
  ownerByFullName: new Map(),
  ownerByLastName: new Map(),
};

const base = {
  申込情報ID: 'M-000000001',
  会員ID: 'K-000000001',
  申込日: '2026/09/18',
};

describe('convertApplicationRow: 列の有無', () => {
  it('「案件」列でも案件を解決できる(2026-09-18 形式。旧形式は「投資案件」)', () => {
    const out = convertApplicationRow({ ...base, 案件: 'ASECコイン' }, 1, maps);
    expect(out.record?.project_id).toBe('7');
  });
  it('ステータス / 入金/移動 の列が無ければレコードに含めない(既存値を保つ)', () => {
    const out = convertApplicationRow({ ...base, 投資案件: 'ASECコイン' }, 1, maps);
    expect(out.record).toBeDefined();
    expect('status' in (out.record ?? {})).toBe(false);
    expect('flow_type' in (out.record ?? {})).toBe(false);
  });
  it('ステータス「失効」は許可し、未知の値は行エラーにする(黙って NULL にしない)', () => {
    const ok = convertApplicationRow({ ...base, 案件: 'ASECコイン', ｽﾃｰﾀｽ: '失効' }, 1, maps);
    expect(ok.record?.status).toBe('失効');
    const ng = convertApplicationRow({ ...base, 案件: 'ASECコイン', ｽﾃｰﾀｽ: '謎' }, 2, maps);
    expect(ng.error).toContain('未対応');
  });
  it('利息 / 契約期日 / 資金移動元 / ｷｬﾝﾍﾟｰﾝ対象金額 は DB 列に入り、extra には入らない', () => {
    const out = convertApplicationRow(
      {
        ...base,
        案件: 'ASECコイン',
        利息: '8',
        契約期日: '2027/05/02',
        資金移動元: 'GPPコイン',
        ｷｬﾝﾍﾟｰﾝ対象金額: '15000',
        会員情報DB反映: '済',
      },
      1,
      maps,
    );
    const r = (out.record ?? {}) as Record<string, unknown>;
    expect(r.interest).toBe(8);
    expect(r.contract_end_date).toBe('2027-05-02');
    expect(r.transfer_from).toBe('GPPコイン');
    expect(r.campaign_target_amount).toBe(15000);
    expect(r.extra).toEqual({ 会員情報DB反映: '済' });
  });
});

describe('mergeApplicationExtra', () => {
  const headers = new Set(['申込情報ID', '案件', '会員情報DB反映', 'ｷｬﾝﾍﾟｰﾝ']);
  it('CSV に無い列のキーは既存のまま残し、ある列だけ差し替える', () => {
    const merged = mergeApplicationExtra(
      { ASECｺｲﾝ数: '100', _inquiry_management_id: 'TA-1', ｷｬﾝﾍﾟｰﾝ: '旧' },
      { 会員情報DB反映: '済', ｷｬﾝﾍﾟｰﾝ: '新春' },
      headers,
    );
    expect(merged).toEqual({
      ASECｺｲﾝ数: '100',
      _inquiry_management_id: 'TA-1',
      ｷｬﾝﾍﾟｰﾝ: '新春',
      会員情報DB反映: '済',
    });
  });
  it('CSV にある列で値が空なら、そのキーは消す(Salesforce 側で空になった)', () => {
    const merged = mergeApplicationExtra({ ｷｬﾝﾍﾟｰﾝ: '旧', 他: 'x' }, {}, headers);
    expect(merged).toEqual({ 他: 'x' });
  });
  it('既存が無ければ CSV の値だけになる', () => {
    expect(mergeApplicationExtra(null, { 会員情報DB反映: '済' }, headers)).toEqual({
      会員情報DB反映: '済',
    });
  });
});
