/**
 * スレッド画面の 1 通の添付ファイル(CLAUDE.md §5.15)。2026-10-23 ユーザー要望: 添付があることを分かりやすく。
 * 本文の上に枠で目立たせ、種類ごとに色の付いたアイコン(画像は縮小表示)・ファイル名・大きさ・「開く」を出す。
 * 電子署名など、開くファイルではない部品は下に小さく出す(splitVisibleAttachments)。
 */

import {
  type AttachmentKind,
  attachmentKind,
  splitVisibleAttachments,
} from '@/lib/domain/mail_attachment_view';
import type { MailAttachment } from '@/lib/domain/mail_types';
import { Paperclip } from 'lucide-react';

const KIND_STYLE: Record<AttachmentKind, string> = {
  pdf: 'bg-red-600',
  excel: 'bg-emerald-700',
  word: 'bg-blue-700',
  powerpoint: 'bg-orange-600',
  image: 'bg-violet-600',
  archive: 'bg-amber-700',
  text: 'bg-slate-500',
  other: 'bg-slate-500',
};

export function formatBytes(n: number | null): string {
  if (n === null || n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function MailAttachmentList({
  attachments,
  signedUrls,
}: {
  attachments: MailAttachment[];
  /** 添付 ID → 短期の閲覧 URL */
  signedUrls: ReadonlyMap<string, string>;
}) {
  const { files, hidden } = splitVisibleAttachments(attachments);
  if (files.length === 0 && hidden.length === 0) return null;

  return (
    <div className="mb-3 space-y-2">
      {files.length > 0 && (
        <section
          aria-label="添付ファイル"
          className="rounded-md border border-sky-300 bg-sky-50 p-2.5"
        >
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-sky-900">
            <Paperclip className="h-4 w-4" aria-hidden="true" />
            添付ファイル({files.length})
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {files.map((a) => {
              const url = signedUrls.get(a.id);
              const { kind, label } = attachmentKind(a.filename, a.content_type);
              const icon =
                kind === 'image' && url ? (
                  <img
                    src={url}
                    alt=""
                    className="h-11 w-11 shrink-0 rounded border object-cover"
                  />
                ) : (
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white ${KIND_STYLE[kind]}`}
                  >
                    {label.slice(0, 5)}
                  </span>
                );
              const body = (
                <>
                  {icon}
                  <span className="min-w-0 flex-1">
                    <span className="block break-all text-sm font-medium text-foreground">
                      {a.filename}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatBytes(a.size_bytes)}
                      {!url && '(取得できません)'}
                    </span>
                  </span>
                  {url && (
                    <span className="shrink-0 rounded border border-sky-300 bg-white px-2 py-1 text-xs text-sky-800">
                      開く
                    </span>
                  )}
                </>
              );
              return (
                <li key={a.id}>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2.5 rounded border bg-white p-2 hover:border-sky-400 hover:shadow-sm"
                    >
                      {body}
                    </a>
                  ) : (
                    <div className="flex items-center gap-2.5 rounded border bg-white p-2 opacity-70">
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {hidden.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          電子署名などの部品 {hidden.length} 件:{' '}
          {hidden.map((a, i) => {
            const url = signedUrls.get(a.id);
            return (
              <span key={a.id}>
                {i > 0 && '、'}
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="sf-link">
                    {a.filename}
                  </a>
                ) : (
                  a.filename
                )}
              </span>
            );
          })}
        </p>
      )}
    </div>
  );
}
