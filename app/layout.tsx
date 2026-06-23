import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ひらプロCRM',
  description: '擬似Salesforce - 対応歴ログ管理システム',
  robots: { index: false, follow: false }, // 社内システムのためインデックス禁止
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
