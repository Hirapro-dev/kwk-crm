/**
 * 会員の性別(members.gender)の選択肢(CLAUDE.md §5.4)。純粋定義。
 *
 * 保存値は既存データ(男 16,825 / 女 6,936 / 法人 124。2026-09-17 時点)と会員情報 CSV の定期取込(§5.10c)に
 * 合わせて「男 / 女 / 法人 / その他」のまま、画面の表示だけ「男性 / 女性 / 法人 / その他」にする
 * (保存値を変えると、CSV 取込で入る「男 / 女」と混在してしまうため)。
 */
export interface SelectOption {
  value: string;
  label: string;
}

export const GENDER_OPTIONS: readonly SelectOption[] = [
  { value: '男', label: '男性' },
  { value: '女', label: '女性' },
  { value: '法人', label: '法人' },
  { value: 'その他', label: 'その他' },
];

/** 保存値 → 表示名。選択肢に無い値(過去データの表記ゆれ)はそのまま返す */
export function genderLabel(value: string | null | undefined): string {
  if (!value) return '';
  return GENDER_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
