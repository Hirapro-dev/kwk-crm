/**
 * メール一元管理(CLAUDE.md §5.15)の型と定数。
 * クライアントコンポーネントからも import できるよう、サーバー専用モジュール
 * (lib/supabase/server 等)に依存させない。DB アクセスは lib/domain/mail.ts。
 */

export const MAIL_STATUSES = ['未対応', '対応中', '完了'] as const;
export type MailStatus = (typeof MAIL_STATUSES)[number];

/** 受信時の自動分類。受信箱の既定表示は「通常」のみ。削除はしない */
export const MAIL_CATEGORIES = ['通常', 'メルマガ', '自動応答', '迷惑メール'] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

/** メッセージの来源。将来の過去データ取込(M4)を区別する */
export const MAIL_SOURCES = ['ses', 'import_maildealer', 'import_server'] as const;

/**
 * まだ mail_boxes に登録していない共有アドレス宛のメールを一時的に集める予約の受信箱(migration 78)。
 * 実在しないドメイン(.invalid, RFC 2606)を使い、本物の共有アドレスと絶対に衝突しないようにする。
 * 常に「受信専用」(SES でドメイン検証されることが無いため送信は選べない)。
 * 該当アドレスを mail_boxes に登録すると、再振り分け(reassign_other_mail_threads)で移動する。
 */
export const OTHER_MAILBOX_ADDRESS = 'other@unassigned.invalid';
export type MailSource = (typeof MAIL_SOURCES)[number];

export interface MailBox {
  id: number;
  /** 公開アドレス。受信時の宛先判定キーであり、送信時の From */
  address: string;
  display_name: string | null;
  signature: string | null;
  is_active: boolean;
}

export interface MailThreadListItem {
  id: string;
  mail_box_id: number;
  subject: string | null;
  member_id: string | null;
  status: MailStatus;
  category: MailCategory;
  assignee_id: string | null;
  last_message_at: string | null;
  last_direction: 'in' | 'out' | null;
  is_read: boolean;
  created_at: string;
  updated_at: string;
  member: { id: string; name: string } | null;
  assignee: { id: string; full_name: string | null } | null;
  /** 一覧表示用: 最新の受信メッセージの差出人 */
  last_from_address?: string | null;
  last_from_name?: string | null;
}

export interface MailAttachment {
  id: string;
  message_id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  storage_path: string;
}

export interface MailMessage {
  id: string;
  thread_id: string;
  direction: 'in' | 'out';
  message_id: string;
  in_reply_to: string | null;
  references_header: string | null;
  from_address: string;
  from_name: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  sent_at: string | null;
  provider_message_id: string | null;
  delivery_status: string | null;
  sender_user_id: string | null;
  source: MailSource;
  created_at: string;
  sender: { id: string; full_name: string | null } | null;
  attachments: MailAttachment[];
}

export interface MailThreadDetail extends MailThreadListItem {
  mail_box: MailBox | null;
  messages: MailMessage[];
}

export interface MailThreadListParams {
  /**
   * ヘッダー検索の入力(会員ID / メールアドレス / キーワードを自動判定。
   * lib/domain/mail_search.ts の classifyMailSearchQuery)。
   */
  q?: string;
  status?: MailStatus;
  /** 未指定なら絞らない。画面側は既定で「通常」を渡す */
  category?: MailCategory;
  /** users.id / 'none' = 未割当 */
  assigneeId?: string;
  mailBoxId?: number;
  unreadOnly?: boolean;
  memberId?: string;
  /** 期間(日本時間の "YYYY-MM-DD")。最終メール日時(last_message_at)で絞り込む */
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface MailThreadListResult {
  rows: MailThreadListItem[];
  total: number;
  page: number;
  pageSize: number;
}
