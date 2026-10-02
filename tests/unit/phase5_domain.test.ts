import { describe, expect, it } from 'vitest';
import { ALL_APP_STATUSES, APP_STATUSES } from '../../lib/domain/applications';
import { PAID_APP_STATUSES } from '../../lib/domain/applications_constants';

// 2026-05 更新: projects.category カラム廃止に伴い PROJECT_CATEGORIES テストを削除。
// 2026-10-02 更新: 区分(flow_type)は画面・項目から外したため FLOW_TYPES のテストを削除。

describe('Phase 5 ドメイン定数(仕様書 §5.6)', () => {
  it('選べるステータスは 対応中 / 入金 / 出金 / 資金移動(2026-10-02 ユーザー指定)', () => {
    expect(APP_STATUSES).toEqual(['対応中', '入金', '出金', '資金移動']);
  });

  it('全ステータスは CHECK 制約と一致(過去の 完了・未購入・失効 も残す。migration 122)', () => {
    expect([...ALL_APP_STATUSES].sort()).toEqual(
      ['対応中', '入金', '出金', '資金移動', '完了', '未購入', '失効'].sort(),
    );
  });

  it('入金済みは「入金」と旧名「完了」', () => {
    expect(PAID_APP_STATUSES).toEqual(['入金', '完了']);
  });
});
