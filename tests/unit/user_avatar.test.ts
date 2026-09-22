import { avatarInitial, avatarObjectKey, avatarPublicUrl } from '@/lib/domain/user_avatar';
import { describe, expect, it } from 'vitest';

/** ユーザーのアイコン(CLAUDE.md §5.1 migration 114)。URL の組み立てとキーの規則を固定する */
describe('avatarPublicUrl', () => {
  it('公開バケットの URL を組み立てる(末尾スラッシュ・日本語キーにも耐える)', () => {
    expect(avatarPublicUrl('https://x.supabase.co/', 'u1/123.jpg')).toBe(
      'https://x.supabase.co/storage/v1/object/public/user-avatars/u1/123.jpg',
    );
  });
  it('path や URL が無ければ null(頭文字の丸を出す)', () => {
    expect(avatarPublicUrl('https://x.supabase.co', null)).toBeNull();
    expect(avatarPublicUrl(undefined, 'u1/1.jpg')).toBeNull();
  });
});

describe('avatarInitial / avatarObjectKey', () => {
  it('氏名の先頭 1 文字、無ければメールの先頭を大文字で', () => {
    expect(avatarInitial('小脇 拓哉')).toBe('小');
    expect(avatarInitial(null, 'taro@example.com')).toBe('T');
    expect(avatarInitial('', '')).toBe('?');
  });
  it('キーは <userId>/<時刻>.<拡張子>。対応外の種類は null', () => {
    expect(avatarObjectKey('u1', 'image/png', 1700000000000)).toBe('u1/1700000000000.png');
    expect(avatarObjectKey('u1', 'image/gif')).toBeNull();
  });
});
