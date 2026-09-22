import { splitLinksAndMentions } from '@/lib/domain/task_pure';

/**
 * 説明・コメントの本文を、URL はリンク、「@氏名」はバッジにして表示する(改行はそのまま)。§5.20。
 * リンクは別タブで開く。外部サイトのため noopener/noreferrer を付ける。
 * mentionNames を渡すと、その氏名の「@氏名」だけをメンションとして強調する(migration 115)。
 */
export function LinkifiedText({
  text,
  className,
  mentionNames = [],
}: {
  text: string;
  className?: string;
  mentionNames?: readonly string[];
}) {
  const segments = splitLinksAndMentions(text, mentionNames);
  return (
    <p className={className ?? 'whitespace-pre-wrap text-sm'}>
      {segments.map((s, i) => {
        if (s.kind === 'link') {
          return (
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
          );
        }
        if (s.kind === 'mention') {
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: 断片は順序固定で再利用しない
              key={i}
              className="rounded bg-sky-100 px-1 font-medium text-sky-800"
            >
              {s.value}
            </span>
          );
        }
        // biome-ignore lint/suspicious/noArrayIndexKey: 断片は順序固定で再利用しない
        return <span key={i}>{s.value}</span>;
      })}
    </p>
  );
}
