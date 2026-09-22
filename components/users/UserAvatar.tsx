import { avatarInitial, avatarPublicUrl } from '@/lib/domain/user_avatar';
import { cn } from '@/lib/utils/cn';

/**
 * ユーザーのアイコン(migration 114)。画像があれば表示、無ければ頭文字の丸。
 * server / client のどちらからでも使える(hooks なし)。公開 URL は NEXT_PUBLIC_SUPABASE_URL から組み立てる。
 */
export function UserAvatar({
  name,
  email,
  avatarPath,
  size = 28,
  className,
}: {
  name: string | null | undefined;
  email?: string | null;
  avatarPath: string | null | undefined;
  /** 一辺のピクセル数 */
  size?: number;
  className?: string;
}) {
  const url = avatarPublicUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, avatarPath);
  const label = name ?? email ?? '';
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.42)) };
  if (url) {
    return (
      <img
        src={url}
        alt={label}
        title={label}
        width={size}
        height={size}
        style={style}
        className={cn('shrink-0 rounded-full object-cover', className)}
      />
    );
  }
  return (
    <span
      aria-label={label}
      title={label}
      style={style}
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-slate-500 font-semibold text-white',
        className,
      )}
    >
      {avatarInitial(name, email)}
    </span>
  );
}
