/**
 * 「永久担当」「OwnerName」等の文字列 → users.id への解決ロジック
 * 仕様書 §6.3:
 *   1. users.full_name 完全一致
 *   2. last_name + first_name 結合 完全一致
 *   3. 姓のみ部分一致
 * いずれも失敗したら NULL を返し、owner_name_raw に元文字列を保存する。
 */

export interface OwnerUser {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
}

export class OwnerResolver {
  private byFullName = new Map<string, OwnerUser>();
  private byLastFirst = new Map<string, OwnerUser>();
  private byLastName = new Map<string, OwnerUser[]>();

  constructor(users: OwnerUser[]) {
    for (const u of users) {
      if (u.full_name) {
        this.byFullName.set(this.normalize(u.full_name), u);
      }
      if (u.last_name && u.first_name) {
        const key = this.normalize(`${u.last_name}${u.first_name}`);
        this.byLastFirst.set(key, u);
      }
      if (u.last_name) {
        const key = this.normalize(u.last_name);
        if (!this.byLastName.has(key)) this.byLastName.set(key, []);
        this.byLastName.get(key)!.push(u);
      }
    }
  }

  /**
   * 文字列の正規化:
   *   - 前後空白除去
   *   - 全角/半角スペースを除去
   */
  private normalize(s: string): string {
    return s.replace(/[\s ]/g, '');
  }

  /**
   * 名前文字列から user を解決。
   * 'Free' / 空 / null は null を返す(永久担当未割当)。
   */
  resolve(rawName: string | null | undefined): OwnerUser | null {
    if (!rawName) return null;
    const trimmed = rawName.trim();
    if (!trimmed) return null;
    // 'Free' は永久担当未割当を意味する(仕様書 §6.3)
    if (trimmed === 'Free' || trimmed === 'free' || trimmed === 'FREE') return null;

    const norm = this.normalize(trimmed);

    // 1. full_name 完全一致
    const f = this.byFullName.get(norm);
    if (f) return f;

    // 2. last_name + first_name 結合
    const lf = this.byLastFirst.get(norm);
    if (lf) return lf;

    // 3. 姓のみ部分一致(候補が1人ならそれを採用、複数なら諦める)
    const candidates = this.byLastName.get(norm);
    if (candidates && candidates.length === 1) {
      return candidates[0]!;
    }

    return null;
  }
}
