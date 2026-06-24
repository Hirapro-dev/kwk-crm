import Image from 'next/image';
import { ResetPasswordForm } from './ResetPasswordForm';

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <div className="w-full max-w-[360px] space-y-8">
        {/* ロゴ */}
        <div className="flex justify-center">
          <Image
            src="/logo.png"
            alt="ロゴ"
            width={180}
            height={64}
            className="object-contain"
            priority
          />
        </div>

        <div className="space-y-2 text-center">
          <h1 className="text-lg font-semibold text-gray-800">新しいパスワードを設定</h1>
          <p className="text-sm text-gray-500">新しいパスワードを入力してください。</p>
        </div>

        <ResetPasswordForm />
      </div>

      <p className="mt-auto pt-12 pb-6 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} mrt inc. All rights reserved.
      </p>
    </main>
  );
}
