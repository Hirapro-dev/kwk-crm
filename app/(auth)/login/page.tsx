import { isDevAuthEnabled } from '@/lib/dev_auth';
import Image from 'next/image';
import { LoginForm } from './LoginForm';

export default function LoginPage() {
  const devAuth = isDevAuthEnabled();
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <div className="w-full max-w-[360px] space-y-8">
        {/* ロゴ — スマホは120px幅、sm以上は180px幅 */}
        <div className="flex flex-col items-center gap-3">
          <Image
            src="/logo.png"
            alt="ロゴ"
            width={180}
            height={64}
            className="h-auto w-[120px] object-contain sm:w-[180px]"
            priority
          />
          {/* ロゴ下のタイトル — 中央寄せ・黒 */}
          <div className="text-center text-black">
            <p className="text-lg font-bold">ひらプロCRM</p>
            <p className="text-sm">ログイン</p>
          </div>
        </div>

        {/* フォーム */}
        {devAuth && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-center text-xs text-amber-700">
            ⚠ 開発バイパスモード（admin / admin）
          </p>
        )}
        <LoginForm devAuth={devAuth} />
      </div>

      {/* コピーライト — absolute で底部固定し、中央コンテンツの位置に影響させない */}
      <p className="absolute bottom-6 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} mrt inc. All rights reserved.
      </p>
    </main>
  );
}
