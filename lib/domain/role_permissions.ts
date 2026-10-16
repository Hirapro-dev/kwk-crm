/**
 * ロールの権限表(CLAUDE.md §7.1 / §7.2)。ユーザー一覧(/settings/users)に表示する読み取り専用の一覧。
 * 権限そのものは DB(RLS)と各 Server Action で決まっており、この表はそれを人が読める形にまとめた説明。
 * 権限を変えたときは、この表も合わせて直すこと(要件定義書「共通(権限・非機能)」とも同じ内容)。
 * 純粋なデータのみ。画面からも import できる。
 */

import { MAIL_APPROVER_ROLES } from './mail_outbox';

/** 権限表の列(ロール)。support は DB と画面で使っているロール(migration 28) */
export const PERMISSION_ROLES = ['admin', 'manager', 'sales', 'support', 'viewer'] as const;
export type PermissionRole = (typeof PERMISSION_ROLES)[number];

export const PERMISSION_ROLE_LABELS: Record<PermissionRole, string> = {
  admin: '管理者',
  manager: 'マネージャ',
  sales: '営業',
  support: 'サポート',
  viewer: '閲覧',
};

/** ○ = できる / △ = 条件付き / × = できない */
export type PermissionMark = '○' | '△' | '×';

export interface PermissionRow {
  action: string;
  marks: Record<PermissionRole, PermissionMark>;
  note?: string;
}

export interface PermissionSection {
  area: 'CRM' | 'メーラー' | 'タスク管理';
  rows: PermissionRow[];
}

const ALL: Record<PermissionRole, PermissionMark> = {
  admin: '○',
  manager: '○',
  sales: '○',
  support: '○',
  viewer: '○',
};
const WRITERS: Record<PermissionRole, PermissionMark> = { ...ALL, viewer: '×' };
const ADMIN_ONLY: Record<PermissionRole, PermissionMark> = {
  admin: '○',
  manager: '×',
  sales: '×',
  support: '×',
  viewer: '×',
};

/** 送信の承認者(mail_outbox.ts の MAIL_APPROVER_ROLES)から表の印を作る。承認者の設定と表がずれないように */
const MAIL_APPROVERS = Object.fromEntries(
  PERMISSION_ROLES.map((r) => [
    r,
    (MAIL_APPROVER_ROLES as readonly string[]).includes(r) ? '○' : '×',
  ]),
) as Record<PermissionRole, PermissionMark>;

export const ROLE_PERMISSION_TABLE: PermissionSection[] = [
  {
    area: 'CRM',
    rows: [
      { action: '会員・問合せ・申込・対応歴などの閲覧', marks: ALL },
      {
        action: '会員・問合せの作成・編集',
        marks: WRITERS,
        note: 'プロテクトの設定は管理者のみ',
      },
      { action: '申込の新規登録', marks: WRITERS },
      { action: '申込の編集', marks: ADMIN_ONLY },
      {
        action: '対応歴の入力',
        marks: WRITERS,
        note: '編集は作成した本人か管理者。削除は管理者のみ',
      },
      { action: '記事反応の会員検索(まとめて紐付け)', marks: WRITERS },
      {
        action: '一覧からの削除(データは消さず非表示)',
        marks: ADMIN_ONLY,
        note: '1 回 500 件まで',
      },
      {
        action: '出金管理の閲覧',
        marks: { admin: '○', manager: '○', sales: '×', support: '○', viewer: '×' },
      },
      { action: '旧社債管理(閲覧・取込・削除)', marks: ADMIN_ONLY },
      {
        action: '設定(データ取込・項目管理・マスタ・ユーザー・ログ)',
        marks: ADMIN_ONLY,
      },
    ],
  },
  {
    area: 'メーラー',
    rows: [
      { action: 'メールの閲覧', marks: ALL, note: '閲覧ロールは開いても既読にならない' },
      { action: '状態・分類・担当の変更(まとめて変更を含む)', marks: WRITERS },
      {
        action: '返信・新規作成(承認依頼)',
        marks: WRITERS,
        note: '送信前に確認画面が出る。営業・サポートは「承認待ち」になる。送信元は SES 認証済みドメインのアドレスだけ',
      },
      {
        action: '承認せずにそのまま送信',
        marks: MAIL_APPROVERS,
        note: '送るときに「承認を依頼する / そのまま送信する」を選べる。承認待ちの自分のメールもそのまま送信できる',
      },
      {
        action: '送信の承認・差し戻し',
        marks: MAIL_APPROVERS,
        note: '自分が作成したメールは自分で承認・差し戻しできない',
      },
      {
        action: '送信待ちメールの修正・出し直し',
        marks: { admin: '△', manager: '△', sales: '△', support: '△', viewer: '×' },
        note: '作成した本人のみ(送信前)',
      },
      {
        action: '送信待ちメールの取消',
        marks: { ...MAIL_APPROVERS, sales: '△', support: '△' },
        note: '承認者はすべて、それ以外は自分が作成したもののみ(送信前)',
      },
      { action: 'メールの削除(データは消さず非表示)', marks: ADMIN_ONLY },
      { action: 'メール設定・取込ルール', marks: ADMIN_ONLY },
    ],
  },
  {
    area: 'タスク管理',
    rows: [
      {
        action: 'プロジェクト・タスクの閲覧',
        marks: { admin: '○', manager: '△', sales: '△', support: '△', viewer: '△' },
        note: '公開プロジェクトと、自分がメンバーの非公開プロジェクト。管理者は全件',
      },
      { action: 'プロジェクトの作成', marks: WRITERS },
      {
        action: 'プロジェクトの設定・アーカイブ・削除',
        marks: { admin: '○', manager: '△', sales: '△', support: '△', viewer: '×' },
        note: '作成した本人のみ',
      },
      {
        action: 'タスクの作成・編集・コメント・添付',
        marks: { admin: '○', manager: '△', sales: '△', support: '△', viewer: '×' },
        note: '閲覧できるプロジェクトの中で',
      },
      {
        action: 'コメントの削除',
        marks: { admin: '○', manager: '△', sales: '△', support: '△', viewer: '×' },
        note: '自分のコメントのみ',
      },
      { action: 'タスクの削除', marks: ADMIN_ONLY },
    ],
  },
];
