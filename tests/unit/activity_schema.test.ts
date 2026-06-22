import { describe, expect, it } from 'vitest';
import { ActivityCreateSchema } from '../../lib/domain/activity_schema';

describe('ActivityCreateSchema', () => {
  it('最低限の入力で通る(d_bunrui のみ)', () => {
    const r = ActivityCreateSchema.safeParse({ d_bunrui: '架電' });
    expect(r.success).toBe(true);
  });

  it('d_bunrui が空ならエラー', () => {
    const r = ActivityCreateSchema.safeParse({ d_bunrui: '' });
    expect(r.success).toBe(false);
  });

  it('member_id: CSV由来 K-XXXXXXX 形式は受け入れる', () => {
    expect(
      ActivityCreateSchema.safeParse({ d_bunrui: '架電', member_id: 'K-0000123' }).success,
    ).toBe(true);
  });

  it('member_id: UUID 形式も受け入れる(本システム新規作成分)', () => {
    expect(
      ActivityCreateSchema.safeParse({
        d_bunrui: '架電',
        member_id: '550e8400-e29b-41d4-a716-446655440000',
      }).success,
    ).toBe(true);
  });

  it('member_id 空文字は undefined 化', () => {
    const r = ActivityCreateSchema.safeParse({ d_bunrui: '架電', member_id: '' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.member_id).toBeUndefined();
  });

  it('member_id が長すぎる場合はエラー', () => {
    expect(
      ActivityCreateSchema.safeParse({
        d_bunrui: '架電',
        member_id: 'a'.repeat(100),
      }).success,
    ).toBe(false);
  });

  it('duration_minutes が文字列でも coerce', () => {
    const r = ActivityCreateSchema.safeParse({ d_bunrui: '架電', duration_minutes: '30' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.duration_minutes).toBe(30);
  });

  it('duration_minutes が異常値ならエラー', () => {
    const r = ActivityCreateSchema.safeParse({ d_bunrui: '架電', duration_minutes: 9999 });
    expect(r.success).toBe(false);
  });

  it('description は 5000字以内', () => {
    const long = 'a'.repeat(5001);
    expect(ActivityCreateSchema.safeParse({ d_bunrui: '架電', description: long }).success).toBe(
      false,
    );
  });
});
