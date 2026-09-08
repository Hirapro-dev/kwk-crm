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
  /** 件名の部分一致 */
  q?: string;
  status?: MailStatus;
  /** 未指定なら絞らない。画面側は既定で「通常」を渡す */
  category?: MailCategory;
  /** users.id / 'none' = 未割当 */
  assigneeId?: string;
  mailBoxId?: number;
  unreadOnly?: boolean;
  memberId?: string;
  page?: number;
  pageSize?: number;
}

export interface MailThreadListResult {
  rows: MailThreadListItem[];
  total: number;
  page: number;
  pageSize: number;
}
