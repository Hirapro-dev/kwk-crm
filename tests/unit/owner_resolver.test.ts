import { describe, expect, it } from 'vitest';
import { OwnerResolver, type OwnerUser } from '../../scripts/migrate/lib/owner_resolver';

const USERS: OwnerUser[] = [
  {
    id: 'uuid-morita',
    email: 'morita@example.com',
    first_name: '和之',
    last_name: '守田',
    full_name: '守田 和之',
  },
  {
    id: 'uuid-suzuki',
    email: 'suzuki@example.com',
    first_name: '太郎',
    last_name: '鈴木',
    full_name: '鈴木 太郎',
  },
  {
    id: 'uuid-suzuki2',
    email: 'suzuki2@example.com',
    first_name: '次郎',
    last_name: '鈴木',
    full_name: '鈴木 次郎',
  },
];

describe('OwnerResolver(仕様書 §6.3)', () => {
  const r = new OwnerResolver(USERS);

  it('full_name 完全一致で解決', () => {
    expect(r.resolve('守田 和之')?.id).toBe('uuid-morita');
  });

  it('スペースを無視して一致(全角空白含む)', () => {
    expect(r.resolve('守田和之')?.id).toBe('uuid-morita');
    expect(r.resolve('守田\u3000和之')?.id).toBe('uuid-morita');
  });

  it('last_name + first_name 結合で一致', () => {
    expect(r.resolve('守田和之')?.id).toBe('uuid-morita');
  });

  it('姓のみ部分一致(候補1人なら採用)', () => {
    expect(r.resolve('守田')?.id).toBe('uuid-morita');
  });

  it('姓のみ部分一致(候補複数なら null)', () => {
    expect(r.resolve('鈴木')).toBeNull();
  });

  it('Free / 空文字 は null', () => {
    expect(r.resolve('Free')).toBeNull();
    expect(r.resolve('free')).toBeNull();
    expect(r.resolve('')).toBeNull();
    expect(r.resolve(null)).toBeNull();
  });
});
