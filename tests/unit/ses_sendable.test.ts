/**
 * 送信元ドメインの確認(lib/mail/ses_send.ts)を、SES の代わりの偽物で確かめる(CLAUDE.md §5.15)。
 * 意図(2026-10-23 の不具合): 受信箱が数百件あっても SES への問い合わせはドメインの数まで・一覧が使えれば 1 回にする。
 * 断られたらやり直す。確認に失敗した結果を長く覚えて「受信専用」のままにしない。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent: string[] = [];
let behavior: (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => unknown;

vi.mock('@/lib/mail/aws', () => ({
  createSesClient: () => ({
    send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push(`${cmd.constructor.name}:${String(cmd.input.EmailIdentity ?? '')}`);
      return behavior(cmd);
    },
  }),
}));

const cfg = {} as never;
const err = (name: string) => Object.assign(new Error(name), { name });

async function load() {
  vi.resetModules();
  return import('@/lib/mail/ses_send');
}

beforeEach(() => {
  sent.length = 0;
});

describe('sendableDomainMap', () => {
  const addresses = [
    ...Array.from({ length: 300 }, (_, i) => `u${i}@ok.example.jp`),
    ...Array.from({ length: 300 }, (_, i) => `u${i}@ng.example.jp`),
  ];

  it('一覧が取れれば SES への問い合わせは 1 回だけ', async () => {
    behavior = (cmd) => {
      if (cmd.constructor.name === 'ListEmailIdentitiesCommand')
        return {
          EmailIdentities: [
            {
              IdentityName: 'ok.example.jp',
              IdentityType: 'DOMAIN',
              VerificationStatus: 'SUCCESS',
              SendingEnabled: true,
            },
          ],
        };
      throw new Error('呼ばれないはず');
    };
    const { sendableDomainMap } = await load();
    const m = await sendableDomainMap(cfg, addresses);
    expect(m.get('ok.example.jp')).toBe(true);
    expect(m.get('ng.example.jp')).toBe(false);
    expect(sent).toEqual(['ListEmailIdentitiesCommand:']);
  });

  it('一覧の権限が無ければ、ドメインごとに 1 回だけ問い合わせる(受信箱の数ではない)', async () => {
    behavior = (cmd) => {
      if (cmd.constructor.name === 'ListEmailIdentitiesCommand') throw err('AccessDeniedException');
      if (cmd.input.EmailIdentity === 'ok.example.jp') return { VerifiedForSendingStatus: true };
      throw err('NotFoundException');
    };
    const { sendableDomainMap } = await load();
    const m = await sendableDomainMap(cfg, addresses);
    expect(m.get('ok.example.jp')).toBe(true);
    expect(m.get('ng.example.jp')).toBe(false);
    expect(sent.filter((s) => s.startsWith('GetEmailIdentityCommand')).sort()).toEqual([
      'GetEmailIdentityCommand:ng.example.jp',
      'GetEmailIdentityCommand:ok.example.jp',
    ]);
  });

  it('SES に断られたら少し待ってやり直し、検証済みなら送信できると判定する', async () => {
    let throttled = 0;
    behavior = (cmd) => {
      if (cmd.constructor.name === 'ListEmailIdentitiesCommand') throw err('AccessDeniedException');
      if (throttled < 2) {
        throttled++;
        throw err('TooManyRequestsException');
      }
      return { VerifiedForSendingStatus: true };
    };
    const { isDomainSendable } = await load();
    expect(await isDomainSendable(cfg, 'ok.example.jp')).toBe(true);
  });

  it('確認に失敗した結果は長く覚えない(次に開いたときに問い合わせ直す)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let fail = true;
      behavior = (cmd) => {
        if (cmd.constructor.name === 'ListEmailIdentitiesCommand')
          throw err('AccessDeniedException');
        if (fail) throw err('InternalFailure');
        return { VerifiedForSendingStatus: true };
      };
      const { isDomainSendable } = await load();
      expect(await isDomainSendable(cfg, 'ok.example.jp')).toBe(false);
      fail = false;
      vi.advanceTimersByTime(31 * 1000);
      expect(await isDomainSendable(cfg, 'ok.example.jp')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
