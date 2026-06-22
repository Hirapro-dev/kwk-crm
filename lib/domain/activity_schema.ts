import { z } from 'zod';

/**
 * 活動入力フォーム用 Zod スキーマ(仕様書 §8.2)。
 *
 * member_id の検証:
 *   - CSV 由来データの ID: K-XXXXXXX(7桁)
 *   - 本システム新規作成の ID: UUID v4
 *   両方を受け入れるため、緩めの検証(空 or 1文字以上)とし、存在チェックは
 *   DB 側の FK 制約に任せる。
 *
 * - duration_minutes は正の整数(または空)
 * - description は最大 5,000 文字(現実的な制限)
 */
export const ActivityCreateSchema = z.object({
  member_id: z
    .string()
    .min(1, '会員IDを入力してください')
    .max(64, '会員IDが長すぎます')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  d_bunrui: z.string().min(1, '大分類は必須です').max(100),
  m_bunrui: z
    .string()
    .max(100)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  s_bunrui: z
    .string()
    .max(100)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  duration_minutes: z
    .number({ coerce: true })
    .int()
    .min(0)
    .max(60 * 24)
    .optional()
    .or(z.nan().transform(() => undefined)),
  description: z.string().max(5000).optional().or(z.literal('').transform(() => undefined)),
  /** ローカル日時 YYYY-MM-DDTHH:mm。未指定なら現在時刻。 */
  registered_at_local: z
    .string()
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export type ActivityCreateInput = z.input<typeof ActivityCreateSchema>;
export type ActivityCreateValues = z.output<typeof ActivityCreateSchema>;
