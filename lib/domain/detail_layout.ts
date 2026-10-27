/**
 * 詳細画面「基本情報」の列数と全幅表示の項目(オブジェクトごと)。
 *
 * 詳細画面(DynamicDetailFields)とオブジェクト管理のレイアウトエディタの両方がここを見る。
 * 列数をここで 1 か所にまとめ、エディタのプレビューが実際の詳細画面と同じ並びになるようにする。
 * 未登録のオブジェクトは 2 列・全幅なし(DynamicDetailFields の既定と同じ)。
 */

export type DetailColumns = 1 | 2 | 3 | 4;

export interface DetailLayout {
  /** グリッドの列数(画面が広いとき) */
  columns: DetailColumns;
  /** グリッドの全幅(全列ぶち抜き)で表示する field_name */
  fullWidthFields: string[];
}

const DETAIL_LAYOUTS: Record<string, DetailLayout> = {
  members: { columns: 2, fullWidthFields: ['remarks'] },
  inquiries: { columns: 4, fullWidthFields: ['備考'] },
  applications: { columns: 4, fullWidthFields: [] },
};

const DEFAULT_DETAIL_LAYOUT: DetailLayout = { columns: 2, fullWidthFields: [] };

export function detailLayoutFor(objectId: string): DetailLayout {
  return DETAIL_LAYOUTS[objectId] ?? DEFAULT_DETAIL_LAYOUT;
}

/**
 * 列数ごとのグリッドのクラス(画面幅で段階的に列を増やす)。
 * Tailwind が静的に拾えるよう、クラス文字列はそのまま書く。
 */
export const DETAIL_GRID_COLUMN_CLASSES: Record<DetailColumns, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
};

/** 全幅表示の項目に付けるクラス(1 列表示のときは指定不要なので sm 以上だけ) */
export const DETAIL_FULL_WIDTH_CLASS = 'sm:col-span-full';
