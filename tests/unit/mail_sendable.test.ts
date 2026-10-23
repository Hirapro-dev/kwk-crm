/**
 * 送信元ドメインの SES 検証状態の判定(CLAUDE.md §5.15)。
 * 意図: 返信・新規作成の画面を開くと、受信箱(約 660 件)ごとに SES へ問い合わせていたため、同時に大量の問い合わせが
 * 出て SES に断られ(スロットリング)、検証済みのドメインまで「受信専用」と表示されていた(2026-10-23)。
 * 一覧 1 回で全ドメインの状態を取る / 同じドメインは 1 回だけ / 同時に問い合わせる数を絞る、を固定する。
 */
import {
  isSesThrottle,
  runWithConcurrency,
  verifiedDomainsFromIdentities,
} from '@/lib/domain/mail_sendable';
import { describe, expect, it } from 'vitest';

describe('verifiedDomainsFromIdentities(SES の ID 一覧から送信できるドメイン)', () => {
  it('検証が成功していて送信が止められていないドメインだけを小文字で返す', () => {
    const s = verifiedDomainsFromIdentities([
      {
        IdentityName: 'Example.co.jp',
        IdentityType: 'DOMAIN',
        VerificationStatus: 'SUCCESS',
        SendingEnabled: true,
      },
      {
        IdentityName: 'pending.jp',
        IdentityType: 'DOMAIN',
        VerificationStatus: 'PENDING',
        SendingEnabled: true,
      },
      {
        IdentityName: 'failed.jp',
        IdentityType: 'DOMAIN',
        VerificationStatus: 'FAILED',
        SendingEnabled: true,
      },
      {
        IdentityName: 'stopped.jp',
        IdentityType: 'DOMAIN',
        VerificationStatus: 'SUCCESS',
        SendingEnabled: false,
      },
      {
        IdentityName: 'user@example.com',
        IdentityType: 'EMAIL_ADDRESS',
        VerificationStatus: 'SUCCESS',
        SendingEnabled: true,
      },
    ]);
    expect([...s]).toEqual(['example.co.jp']);
  });
});

describe('isSesThrottle(SES に断られたか)', () => {
  it('回数制限のエラーだけ true(やり直す対象)', () => {
    expect(isSesThrottle({ name: 'TooManyRequestsException' })).toBe(true);
    expect(isSesThrottle({ name: 'ThrottlingException' })).toBe(true);
    expect(isSesThrottle({ name: 'NotFoundException' })).toBe(false);
    expect(isSesThrottle(new Error('x'))).toBe(false);
  });
});

describe('runWithConcurrency(同時に動かす数を絞る)', () => {
  it('すべて処理し、同時に動くのは上限まで。結果は入力の順', async () => {
    let running = 0;
    let peak = 0;
    const out = await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBe(3);
  });
});
