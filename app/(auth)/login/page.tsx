import Image from 'next/image';
import { isDevAuthEnabled } from '@/lib/dev_auth';
import { LoginForm } from './LoginForm';

export default function LoginPage() {
  const devAuth = isDevAuthEnabled();
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-[360px]">
        {/* ロゴ */}
        <div className="mb-10 flex justify-center">
          <Image
            src="/logo.png"
            alt="ロゴ"
            width={180}
            height={64}
            className="object-contain"
            priority
          />
        </div>

        {/* カード */}
        <div className="rounded-2xl border border-gray-100 bg-white px-8 py-8 shadow-[0_4px_24px_rgba(0,0,0,0.08)]">
          {devAuth && (
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-center text-xs text-amber-700">
              ⚠ 開発バイパスモード（admin / admin）
            </p>
          )}
          <LoginForm devAuth={devAuth} />
        </div>
      </div>
    </main>
  );
}
