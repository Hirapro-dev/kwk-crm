/**
 * 電話番号を tel: リンクで表示する。スマホでタップすると発信できる。
 * サーバーコンポーネントでもそのまま使える(クライアント不要)。
 */
export function PhoneLink({
  value,
  className,
}: {
  value: string | null | undefined;
  className?: string;
}) {
  if (!value || String(value).trim() === '') return <>-</>;
  const text = String(value);
  // tel: には数字と先頭+のみ残す
  const tel = text.replace(/[^\d+]/g, '');
  if (!tel) return <>{text}</>;
  return (
    <a href={`tel:${tel}`} className={className ?? 'text-primary hover:underline'}>
      {text}
    </a>
  );
}
