/**
 * 仕様書 §9.8: 安全な SQL Builder のための「ホワイトリスト」を定義する。
 *
 * - レポートタイプごとに「許可されたカラム」「許可された結合」「許可されたフィルタ対象」を固定。
 * - 文字列連結による動的 SQL 生成は禁止。すべて Supabase クライアントのパラメータバインドを通す。
 *
 * Phase 6 で各レポートタイプの詳細定義を追記する。本ファイルは雛形のみ。
 */

import type { ReportTypeId } from './types';

export interface AllowedColumn {
  source: string; // 'members.name' 等
  label: string;
  dataType: 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'jsonb' | 'enum';
  aggregatable?: boolean;
}

export interface AllowedJoin {
  alias: string;
  table: string;
  on: string; // 'members.owner_id = users.id' の論理表現(builder で物理クエリに変換)
  type: 'inner' | 'left';
}

export interface ReportTypeSchema {
  reportType: ReportTypeId;
  baseTable: string;
  allowedJoins: AllowedJoin[];
  allowedColumns: AllowedColumn[];
}

/**
 * Phase 6 で全タイプ分を定義する。
 * ここでは最小例(RT02 会員サマリ)のみ宣言しておく。
 */
export const REPORT_SCHEMAS: Partial<Record<ReportTypeId, ReportTypeSchema>> = {
  RT02: {
    reportType: 'RT02',
    baseTable: 'members',
    allowedJoins: [
      { alias: 'owner', table: 'users', on: 'members.owner_id = users.id', type: 'left' },
      {
        alias: 'apps',
        table: 'applications',
        on: 'applications.member_id = members.id AND applications.deleted_at IS NULL',
        type: 'left',
      },
      {
        alias: 'acts',
        table: 'activities',
        on: 'activities.member_id = members.id AND activities.deleted_at IS NULL',
        type: 'left',
      },
    ],
    allowedColumns: [
      { source: 'members.id', label: '会員ID', dataType: 'text' },
      { source: 'members.name', label: '会員氏名', dataType: 'text' },
      { source: 'members.email1', label: 'メール', dataType: 'text' },
      { source: 'members.total_amount', label: '総取引額', dataType: 'number', aggregatable: true },
      { source: 'owner.full_name', label: '担当者', dataType: 'text' },
      { source: 'apps.id', label: '申込件数', dataType: 'text', aggregatable: true },
      {
        source: 'apps.payment_amount',
        label: '総入金額',
        dataType: 'number',
        aggregatable: true,
      },
      {
        source: 'acts.registered_datetime',
        label: '最終活動日',
        dataType: 'datetime',
        aggregatable: true,
      },
      { source: 'acts.id', label: '活動件数', dataType: 'text', aggregatable: true },
    ],
  },
};
