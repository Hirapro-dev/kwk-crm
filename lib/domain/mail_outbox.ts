/**
 * メーラーの送信承認・送信予約(CLAUDE.md §5.15 / migration 124)の決定論的ロジック。
 * 純粋関数のみ(DB・外部 API に触れない)。画面(クライアント)からも import できる。
 *
 * 決めていること:
 *   - 誰が承認・差し戻し・取消・修正できるか
 *   - 承認したときにすぐ送るか、予約日時まで待つか
 *   - 送信予約の入力(日本時間の "YYYY-MM-DDTHH:mm")の解釈と範囲チェック
 */

import type { UserRole } from './types';

export type MailOutboxStatus =
  | 'pending'
  | 'rejected'
  | 'approved'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled';

export type MailOutboxKind = 'reply' | 'new';

export const MAIL_OUTBOX_STATUS_LABELS: Record<MailOutboxStatus, string> = {
  pending: '承認待ち',
  rejected: '差し戻し',
  approved: '予約中',
  sending: '送信中',
  sent: '送信済み',
  failed: '送信失敗',
  cancelled: '取消',
};

/** 承認できるロール(2026-10-15 ユーザー決定: admin と manager) */
export const MAIL_APPROVER_ROLES: readonly UserRole[] = ['admin', 'manager'];

/**
 * 自分が作成したメールを自分で承認できるか。
 * 【要確認】初期値は不可(承認は別の人が内容を確かめる仕組みのため。admin 11 名・manager 2 名で運用できる)。
 */
export const ALLOW_SELF_APPROVAL = false;

/** 送信予約の上限(誤入力で何年も先に入るのを防ぐ) */
export const MAX_SCHEDULE_DAYS = 365;

/** 差し戻し理由の上限 */
export const MAX_REJECT_REASON_CHARS = 1000;

export interface OutboxActor {
  id: string;
  role: UserRole;
}

export interface OutboxPermissionTarget {
  status: MailOutboxStatus;
  created_by: string;
}

export function isMailApprover(role: UserRole): boolean {
  return MAIL_APPROVER_ROLES.includes(role);
}

/** 承認できるか: 承認者のロールで、承認待ちで、(自己承認不可なら)自分の作成でない */
export function canApproveOutbox(actor: OutboxActor, item: OutboxPermissionTarget): boolean {
  if (!isMailApprover(actor.role)) return false;
  if (item.status !== 'pending') return false;
  if (!ALLOW_SELF_APPROVAL && item.created_by === actor.id) return false;
  return true;
}

/** 差し戻しできるか: 承認者のロールで、承認待ちか予約中(送る前)。自分のものは差し戻さず取消・修正する */
export function canRejectOutbox(actor: OutboxActor, item: OutboxPermissionTarget): boolean {
  if (!isMailApprover(actor.role)) return false;
  if (item.created_by === actor.id) return false;
  return item.status === 'pending' || item.status === 'approved';
}

/** 送る前の状態(修正・取消ができる) */
const EDITABLE: readonly MailOutboxStatus[] = ['pending', 'rejected', 'approved', 'failed'];

/** 修正して出し直せるか: 作成者本人で、まだ送っていない */
export function canEditOutbox(actor: OutboxActor, item: OutboxPermissionTarget): boolean {
  if (actor.role === 'viewer') return false;
  return item.created_by === actor.id && EDITABLE.includes(item.status);
}

/** 取消できるか: 作成者本人か承認者で、まだ送っていない */
export function canCancelOutbox(actor: OutboxActor, item: OutboxPermissionTarget): boolean {
  if (actor.role === 'viewer') return false;
  if (!EDITABLE.includes(item.status)) return false;
  return item.created_by === actor.id || isMailApprover(actor.role);
}

/** 送信失敗をもう一度送れるか: 承認者(承認済みの内容をそのまま送り直す) */
export function canRetryOutbox(actor: OutboxActor, item: OutboxPermissionTarget): boolean {
  return isMailApprover(actor.role) && item.status === 'failed';
}

/**
 * 承認(または送り直し)の時点で、すぐ送るか予約日時まで待つか。
 * 予約なし、または予約日時を過ぎている(承認が遅れた)ならすぐ送る。
 */
export function isDueNow(scheduledAt: string | null | undefined, now: Date): boolean {
  if (!scheduledAt) return true;
  const t = Date.parse(scheduledAt);
  if (Number.isNaN(t)) return true;
  return t <= now.getTime();
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 送信予約の入力(<input type="datetime-local"> の値。日本時間として扱う)を ISO 文字列にする。
 * - 空 → null(予約なし = 承認したらすぐ送る)
 * - 過去・今から 1 分以内 → エラー(「今すぐ」と区別するため)
 * - MAX_SCHEDULE_DAYS 日より先 → エラー
 */
export function parseScheduledInput(
  value: string | null | undefined,
  now: Date,
): { at: string | null; error?: string } {
  const v = (value ?? '').trim();
  if (!v) return { at: null };
  const m = v.match(LOCAL_RE);
  if (!m) return { at: null, error: '送信日時の形式が正しくありません' };
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const utc = Date.UTC(y, mo - 1, d, h, mi) - JST_OFFSET_MS;
  const check = new Date(utc + JST_OFFSET_MS);
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    h > 23 ||
    mi > 59
  ) {
    return { at: null, error: '送信日時が正しくありません' };
  }
  if (utc <= now.getTime() + 60_000) {
    return { at: null, error: '送信日時は今より後(1 分以上先)を指定してください' };
  }
  if (utc > now.getTime() + MAX_SCHEDULE_DAYS * 24 * 60 * 60 * 1000) {
    return { at: null, error: `送信日時は ${MAX_SCHEDULE_DAYS} 日以内で指定してください` };
  }
  return { at: new Date(utc).toISOString() };
}

/** ISO 日時 → datetime-local の値(日本時間 "YYYY-MM-DDTHH:mm")。編集フォームの初期値用 */
export function toScheduledInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const j = new Date(t + JST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${j.getUTCFullYear()}-${p(j.getUTCMonth() + 1)}-${p(j.getUTCDate())}T${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
}

/** 送信待ち一覧のタブ(?tab=) */
export const MAIL_OUTBOX_TABS = [
  { key: 'pending', label: '承認待ち', statuses: ['pending'] },
  { key: 'scheduled', label: '予約中', statuses: ['approved', 'sending'] },
  { key: 'rejected', label: '差し戻し', statuses: ['rejected'] },
  { key: 'failed', label: '送信失敗', statuses: ['failed'] },
  { key: 'sent', label: '送信済み', statuses: ['sent'] },
  { key: 'cancelled', label: '取消', statuses: ['cancelled'] },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  statuses: readonly MailOutboxStatus[];
}>;

export type MailOutboxTabKey = (typeof MAIL_OUTBOX_TABS)[number]['key'];

export function resolveOutboxTab(v: string | null | undefined): MailOutboxTabKey {
  return MAIL_OUTBOX_TABS.some((t) => t.key === v) ? (v as MailOutboxTabKey) : 'pending';
}

export function outboxTabStatuses(tab: MailOutboxTabKey): readonly MailOutboxStatus[] {
  return MAIL_OUTBOX_TABS.find((t) => t.key === tab)?.statuses ?? ['pending'];
}

/** 送信ボタンを押した直後の案内文 */
export function submittedMessage(scheduledAt: string | null): string {
  return scheduledAt
    ? '承認依頼を出しました。承認されると指定の日時に送信されます'
    : '承認依頼を出しました。承認されると送信されます';
}

/**
 * 送信方法(2026-10-16 追加。ユーザー決定)。
 * - approval: 承認を依頼する(承認待ちにする)
 * - direct: 承認せずにそのまま送る(予約があれば指定日時に送る)。承認者(admin / manager)だけが選べる
 * 承認者以外(sales / support)は承認の依頼だけ(対象は全メールの方針は変えない)。
 */
export type MailSendMode = 'approval' | 'direct';

/** そのまま送信を選べるか(承認者のロールだけ) */
export function canDirectSend(role: UserRole): boolean {
  return isMailApprover(role);
}

/** 画面から来た送信方法を確定する。承認者以外が direct を指定したらエラー */
export function resolveSendMode(
  requested: string | null | undefined,
  role: UserRole,
): { mode: MailSendMode; error?: string } {
  if (requested !== 'direct') return { mode: 'approval' };
  if (!canDirectSend(role)) {
    return { mode: 'approval', error: 'そのまま送信できるのは承認者(admin / manager)だけです' };
  }
  return { mode: 'direct' };
}

/**
 * 承認待ちの自分のメールを、承認者本人が承認なしでそのまま送れるか(承認待ちのまま止まった自分のメールの救済)。
 * 他人のメールは通常の承認(canApproveOutbox)で送る。
 */
export function canSendOwnNow(actor: OutboxActor, item: OutboxPermissionTarget): boolean {
  return isMailApprover(actor.role) && item.created_by === actor.id && item.status === 'pending';
}

/** そのまま送信したときの案内文 */
export function directSentMessage(scheduledAt: string | null): string {
  return scheduledAt ? '送信を予約しました。指定の日時に送信されます' : '送信しました';
}

/** 確認画面に出す送信日時(datetime-local の値 → "YYYY/MM/DD HH:mm"。空なら null) */
export function scheduleInputLabel(value: string | null | undefined): string | null {
  const m = (value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  return m ? `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}` : null;
}

/** 送信待ちメールの確認画面の種類(承認 / 承認者本人のそのまま送信 / 送信失敗の送り直し) */
export type OutboxConfirmKind = 'approve' | 'sendNow' | 'retry';

/**
 * 送信待ちメールの確認画面(SendConfirmDialog)の文言(2026-10-16)。
 * 予約なし・予約日時を過ぎている(dueNow)ならすぐ送る、先なら予約日時に送る旨を出し分ける。
 */
export function outboxConfirmTexts(
  kind: OutboxConfirmKind,
  info: { scheduledLabel: string | null; dueNow: boolean },
): {
  title: string;
  lead: string;
  methodLabel: string;
  whenLabel: string;
  confirmLabel: string;
  cancelLabel: string;
} {
  const when = info.dueNow
    ? info.scheduledLabel
      ? `予約日時(${info.scheduledLabel})を過ぎているため、すぐに送信`
      : 'すぐに送信'
    : `${info.scheduledLabel} に送信(予約)`;
  const sendLabel = info.dueNow ? '送信する' : '予約して送信する';
  if (kind === 'approve') {
    return {
      title: '承認内容の確認',
      lead: `この内容を承認します。承認すると${info.dueNow ? 'すぐに送信' : '指定の日時に送信'}されます。`,
      methodLabel: '承認して送信',
      whenLabel: when,
      confirmLabel: info.dueNow ? '承認して送信する' : '承認する(予約日時に送信)',
      cancelLabel: 'キャンセル',
    };
  }
  if (kind === 'sendNow') {
    return {
      title: '送信内容の確認',
      lead: '承認を待たずに、この内容で送信します。',
      methodLabel: '承認せずにそのまま送信',
      whenLabel: when,
      confirmLabel: sendLabel,
      cancelLabel: 'キャンセル',
    };
  }
  return {
    title: '再送信の確認',
    lead: '送信に失敗したメールを、この内容で送り直します。',
    methodLabel: '送り直す(承認済みの内容のまま)',
    whenLabel: when,
    confirmLabel: sendLabel,
    cancelLabel: 'キャンセル',
  };
}
