import { deliveryStatusLabel, isDeliveryProblem } from '@/lib/domain/mail_delivery';
import { describe, expect, it } from 'vitest';

// 送信メールの配信状態の表示(CLAUDE.md §5.15)。SES の通知で更新される英語の値を、画面では日本語で出す
describe('deliveryStatusLabel(配信状態の日本語表示)', () => {
  it('各状態を日本語にする', () => {
    // queued は「送った直後で、配信の結果の通知をまだ受け取っていない」状態
    expect(deliveryStatusLabel('queued')).toBe('配信確認中');
    expect(deliveryStatusLabel('sent')).toBe('送信済み');
    expect(deliveryStatusLabel('delivered')).toBe('配信済み');
    expect(deliveryStatusLabel('bounced')).toBe('不達');
    expect(deliveryStatusLabel('failed')).toBe('失敗');
  });

  it('知らない値はそのまま出す(黙って消さない)', () => {
    expect(deliveryStatusLabel('unknown_x')).toBe('unknown_x');
  });

  it('値が無ければ空文字', () => {
    expect(deliveryStatusLabel(null)).toBe('');
    expect(deliveryStatusLabel(undefined)).toBe('');
  });
});

describe('isDeliveryProblem(赤字にする状態)', () => {
  it('不達・失敗だけ true', () => {
    expect(isDeliveryProblem('bounced')).toBe(true);
    expect(isDeliveryProblem('failed')).toBe(true);
    expect(isDeliveryProblem('delivered')).toBe(false);
    expect(isDeliveryProblem('queued')).toBe(false);
    expect(isDeliveryProblem(null)).toBe(false);
  });
});
