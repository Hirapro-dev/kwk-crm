/**
 * レポート新規作成フロー用: オブジェクトの組み合わせ → レポートタイプ(RT) 解決。
 *
 * 設計(2026-06):
 *   新規レポートの導線を「レポートタイプ選択」から「オブジェクト選択(主軸 + 任意の結合)」に
 *   変更するための対応表。SQL 生成・ホワイトリスト(schema_all.ts)は無改修のまま、
 *   選択された組み合わせを既存の RT01〜RT10 に解決して既存ビルダーに渡す。
 *
 *   - 主軸オブジェクト(base)は必須、結合オブジェクト(related)は任意
 *   - 結合キーが定義済みの組み合わせのみ relations に列挙する(未定義の組み合わせは選べない)
 *   - 申込/対応歴/問合せ系の RT は元々関連オブジェクトを全て JOIN 済みのため、
 *     related を変えても同じ RT に解決される(その場合 related はカラム選択の意図表明)
 *
 * 集計系テンプレート(RT02 会員サマリ / RT08 対応歴マトリクス / RT10 案件別実績)は
 * 1行=複数レコードでありオブジェクト選択フローに馴染まないため、本対応表には含めず
 * 新規作成画面の「集計テンプレート」セクションから別途選択する。
 */

import type { ReportTypeId } from './types';

export interface RelatedObjectDef {
  /** object_definitions.id 相当のキー */
  key: string;
  /** 表示ラベル */
  label: string;
  /** この組み合わせで解決されるレポートタイプ */
  type: ReportTypeId;
}

export interface BaseObjectDef {
  key: string;
  label: string;
  /** リストヘッダー等で使う短いラベル(3文字程度) */
  iconLabel: string;
  /** 結合なし(主軸のみ)で選んだ場合の RT */
  soloType: ReportTypeId;
  /** 結合なし時の説明 */
  soloDescription: string;
  /** 結合可能なオブジェクト一覧 */
  relations: RelatedObjectDef[];
}

export const BASE_OBJECTS: BaseObjectDef[] = [
  {
    key: 'members',
    label: '会員',
    iconLabel: 'MEM',
    soloType: 'RT01',
    soloDescription: '会員と担当者の一覧',
    relations: [
      { key: 'applications', label: '申込', type: 'RT03' },
      { key: 'activities', label: '対応歴', type: 'RT04' },
      { key: 'inquiries', label: '問合せ', type: 'RT05' },
    ],
  },
  {
    key: 'applications',
    label: '申込',
    iconLabel: 'APP',
    soloType: 'RT06',
    soloDescription: '申込と関連オブジェクトの一覧',
    relations: [
      { key: 'members', label: '会員', type: 'RT06' },
      { key: 'projects', label: '案件', type: 'RT06' },
      { key: 'users', label: '担当者', type: 'RT06' },
    ],
  },
  {
    key: 'activities',
    label: '対応歴',
    iconLabel: 'ACT',
    soloType: 'RT07',
    soloDescription: '対応歴とその会員・担当者の一覧',
    relations: [
      { key: 'members', label: '会員', type: 'RT07' },
      { key: 'users', label: '担当者', type: 'RT07' },
    ],
  },
  {
    key: 'inquiries',
    label: '問合せ',
    iconLabel: 'INQ',
    soloType: 'RT09',
    soloDescription: '問合せ(フォーム種別・会員紐付け含む)の一覧',
    relations: [
      { key: 'forms', label: 'フォーム', type: 'RT09' },
      { key: 'members', label: '会員', type: 'RT09' },
    ],
  },
];

/**
 * 主軸 + (任意)結合 から レポートタイプを解決する。
 * 解決できない組み合わせは null。
 */
export function resolveReportType(
  baseKey: string,
  relatedKey?: string,
): ReportTypeId | null {
  const base = BASE_OBJECTS.find((b) => b.key === baseKey);
  if (!base) return null;
  if (!relatedKey) return base.soloType;
  const rel = base.relations.find((r) => r.key === relatedKey);
  return rel ? rel.type : null;
}

/** 集計系テンプレート(オブジェクト選択フロー外で提供) */
export const SUMMARY_TEMPLATE_TYPES: ReportTypeId[] = ['RT02', 'RT08', 'RT10'];
