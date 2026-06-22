import { describe, expect, it } from 'vitest';
import { APP_STATUSES, FLOW_TYPES } from '../../lib/domain/applications';

// 2026-05 更新: projects.category カラム廃止に伴い PROJECT_CATEGORIES テストを削除。

describe('Phase 5 ドメイン定数(仕様書 §5.6)', () => {
  it('APP_STATUSES が CHECK 制約と一致(仕様書 §5.6)', () => {
    expect(APP_STATUSES).toEqual(['対応中', '未購入', '完了', '出金', '資金移動']);
  });

  it('FLOW_TYPES が CHECK 制約と一致(仕様書 §5.6)', () => {
    expect(FLOW_TYPES).toEqual(['入金', '出金', '資金移動', 'W']);
  });
});
