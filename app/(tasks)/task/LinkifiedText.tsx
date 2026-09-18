import { splitLinks } from '@/lib/domain/task_pure';

/**
 * 説明・コメントの本文を、URL だけリンクにして表示する(改行はそのまま)。§5.20。
 * リンクは別タブで開く。外部サイトのため noopener/noreferrer を付ける。
 */
export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  const segments = splitLinks(text);
  return (
    <p className={className ?? 'whitespace-pre-wrap text-sm'}>
      {segments.map((s, i) =>
        s.kind === 'link' ? (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: 断片は順序固定で再利用しない
            key={i}
            href={s.value}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-primary underline-offset-2 hover:underline"
          >
            {s.value}
          </a>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: 断片は順序固定で再利用しない
          <span key={i}>{s.value}</span>
        ),
      )}
    </p>
  );
}
