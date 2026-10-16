/**
 * 送信承認・送信予約(CLAUDE.md §5.15 migration 124)の純粋関数のテスト。
 * 意図: 承認は admin / manager だけ・自分のメールは自分で承認できない(別の人が確かめる)・
 *       送った後(送信中・送信済み・取消)は誰も触れない・予約日時は日本時間で解釈する。
 */
import {
  canApproveOutbox,
  canCancelOutbox,
  canEditOutbox,
  canRejectOutbox,
  canRetryOutbox,
  canSendOwnNow,
  isDueNow,
  outboxTabStatuses,
  parseScheduledInput,
  resolveOutboxTab,
  resolveSendMode,
  scheduleInputLabel,
  toScheduledInputValue,
} from '@/lib/domain/mail_outbox';
import { describe, expect, it } from 'vitest';

const author = { id: 'u-author', role: 'sales' as const };
const admin = { id: 'u-admin', role: 'admin' as const };
const manager = { id: 'u-manager', role: 'manager' as const };
const viewer = { id: 'u-viewer', role: 'viewer' as const };
const item = (status: Parameters<typeof canApproveOutbox>[1]['status'], createdBy = author.id) => ({
  status,
  created_by: createdBy,
});

describe('承認', () => {
  it('admin と manager は承認待ちを承認できる', () => {
    expect(canApproveOutbox(admin, item('pending'))).toBe(true);
    expect(canApproveOutbox(manager, item('pending'))).toBe(true);
  });
  it('sales・viewer は承認できない', () => {
    expect(canApproveOutbox(author, item('pending', 'other'))).toBe(false);
    expect(canApproveOutbox(viewer, item('pending'))).toBe(false);
  });
  it('自分が作成したメールは自分で承認できない(admin でも)', () => {
    expect(canApproveOutbox(admin, item('pending', admin.id))).toBe(false);
  });
  it('承認待ち以外は承認できない', () => {
    for (const s of ['rejected', 'approved', 'sending', 'sent', 'failed', 'cancelled'] as const) {
      expect(canApproveOutbox(admin, item(s))).toBe(false);
    }
  });
});

describe('差し戻し・修正・取消・送り直し', () => {
  it('差し戻しは承認者が送る前(承認待ち・予約中)にできる。自分のものは差し戻さない', () => {
    expect(canRejectOutbox(manager, item('pending'))).toBe(true);
    expect(canRejectOutbox(manager, item('approved'))).toBe(true);
    expect(canRejectOutbox(manager, item('sent'))).toBe(false);
    expect(canRejectOutbox(author, item('pending', 'other'))).toBe(false);
    expect(canRejectOutbox(admin, item('pending', admin.id))).toBe(false);
  });
  it('修正は作成者本人だけ。送る前ならどの状態からでも出し直せる', () => {
    for (const s of ['pending', 'rejected', 'approved', 'failed'] as const) {
      expect(canEditOutbox(author, item(s))).toBe(true);
    }
    expect(canEditOutbox(admin, item('pending'))).toBe(false);
    for (const s of ['sending', 'sent', 'cancelled'] as const) {
      expect(canEditOutbox(author, item(s))).toBe(false);
    }
  });
  it('取消は作成者か承認者。送信中・送信済みは取り消せない', () => {
    expect(canCancelOutbox(author, item('approved'))).toBe(true);
    expect(canCancelOutbox(manager, item('pending'))).toBe(true);
    expect(canCancelOutbox({ id: 'x', role: 'sales' }, item('pending'))).toBe(false);
    expect(canCancelOutbox(author, item('sending'))).toBe(false);
    expect(canCancelOutbox(author, item('sent'))).toBe(false);
  });
  it('送り直しは承認者が送信失敗に対してだけ', () => {
    expect(canRetryOutbox(admin, item('failed'))).toBe(true);
    expect(canRetryOutbox(author, item('failed'))).toBe(false);
    expect(canRetryOutbox(admin, item('pending'))).toBe(false);
  });
});

describe('isDueNow', () => {
  const now = new Date('2026-10-15T03:00:00Z');
  it('予約なしは承認したらすぐ送る', () => {
    expect(isDueNow(null, now)).toBe(true);
  });
  it('予約日時が先なら待つ。過ぎていれば(承認が遅れた)すぐ送る', () => {
    expect(isDueNow('2026-10-15T04:00:00Z', now)).toBe(false);
    expect(isDueNow('2026-10-15T02:00:00Z', now)).toBe(true);
  });
});

describe('parseScheduledInput', () => {
  // 2026-10-15 12:00 JST
  const now = new Date('2026-10-15T03:00:00Z');
  it('空は予約なし', () => {
    expect(parseScheduledInput('', now)).toEqual({ at: null });
  });
  it('日本時間として解釈する', () => {
    expect(parseScheduledInput('2026-10-16T09:30', now)).toEqual({
      at: '2026-10-16T00:30:00.000Z',
    });
  });
  it('過去・1 分以内はエラー', () => {
    expect(parseScheduledInput('2026-10-15T11:00', now).error).toBeTruthy();
    expect(parseScheduledInput('2026-10-15T12:00', now).error).toBeTruthy();
  });
  it('1 年より先・形式不正・存在しない日付はエラー', () => {
    expect(parseScheduledInput('2027-10-20T09:00', now).error).toBeTruthy();
    expect(parseScheduledInput('2026/10/16 09:00', now).error).toBeTruthy();
    expect(parseScheduledInput('2026-02-30T09:00', now).error).toBeTruthy();
  });
  it('toScheduledInputValue と往復できる', () => {
    const at = parseScheduledInput('2026-12-01T18:05', now).at;
    expect(toScheduledInputValue(at)).toBe('2026-12-01T18:05');
    expect(toScheduledInputValue(null)).toBe('');
  });
});

describe('タブ', () => {
  it('不明な値は承認待ち。予約中タブは送信中も含む', () => {
    expect(resolveOutboxTab('xxx')).toBe('pending');
    expect(resolveOutboxTab('scheduled')).toBe('scheduled');
    expect(outboxTabStatuses('scheduled')).toEqual(['approved', 'sending']);
  });
});

describe('送信方法(承認を依頼 / そのまま送信)', () => {
  it('承認者(admin / manager)だけがそのまま送信を選べる', () => {
    expect(resolveSendMode('direct', 'admin')).toEqual({ mode: 'direct' });
    expect(resolveSendMode('direct', 'manager')).toEqual({ mode: 'direct' });
    expect(resolveSendMode('direct', 'sales').error).toBeTruthy();
  });
  it('指定なし・承認依頼は承認待ちにする', () => {
    expect(resolveSendMode(undefined, 'admin')).toEqual({ mode: 'approval' });
    expect(resolveSendMode('approval', 'sales')).toEqual({ mode: 'approval' });
  });
  it('承認待ちの自分のメールは、承認者本人ならそのまま送れる', () => {
    expect(canSendOwnNow(admin, item('pending', admin.id))).toBe(true);
    expect(canSendOwnNow(admin, item('pending'))).toBe(false);
    expect(canSendOwnNow(author, item('pending'))).toBe(false);
    expect(canSendOwnNow(admin, item('rejected', admin.id))).toBe(false);
  });
  it('確認画面の送信日時の表示', () => {
    expect(scheduleInputLabel('2026-10-17T09:30')).toBe('2026/10/17 09:30');
    expect(scheduleInputLabel('')).toBeNull();
  });
});
