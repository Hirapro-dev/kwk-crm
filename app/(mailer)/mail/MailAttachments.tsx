'use client';

/**
 * 送信メールの添付(CLAUDE.md §5.15「送信メールの添付」/ migration 128)。返信・新規作成フォームで共通に使う。
 * - 添付欄: 「ファイルを添付」ボタン、または欄へのドラッグ&ドロップ。PDF・JPG・PNG だけ
 * - 本文の欄: 画像をドラッグ&ドロップ / 貼り付けすると、カーソルの位置に「[画像: 名前]」の目印を入れ、相手には本文のその位置に画像を出す。
 *   PDF は本文に落としても通常の添付になる
 * - 選んだ時点で Storage へ直接アップロードする(終わるまで送信できない)
 */

import { Button } from '@/components/ui/button';
import {
  MAIL_ATTACHMENT_ACCEPT,
  MAIL_ATTACHMENT_MAX_FILES,
  MAIL_ATTACHMENT_MAX_TOTAL_BYTES,
  type SubmittedAttachment,
  checkNewAttachments,
  inlineMarker,
  insertMarkerAt,
  isInlineImageType,
  removeMarker,
  uniqueFilename,
} from '@/lib/domain/mail_outgoing_attachments';
import { uploadMailAttachment } from '@/lib/mail/attachment_upload_client';
import { type DragEvent, useCallback, useEffect, useRef, useState } from 'react';

export interface MailAttachmentItem {
  key: string;
  filename: string;
  size: number;
  contentType: string;
  /** 本文中の画像か */
  inline: boolean;
  status: 'uploading' | 'done' | 'error';
  path?: string;
  error?: string;
  /** 画像の縮小表示用(ブラウザ内の一時 URL) */
  previewUrl?: string;
}

export function formatAttachmentSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

/** 添付の状態とアップロード。本文の目印の差し込み・削除は呼び出し側の本文に対して行う */
export function useMailAttachments() {
  const [items, setItems] = useState<MailAttachmentItem[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // 画面を離れたら一時 URL を捨てる
  useEffect(
    () => () => {
      for (const it of itemsRef.current) if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    },
    [],
  );

  /**
   * ファイルを追加してアップロードを始める。受け付けたもの(同名はずらした名前)をすぐ返す
   * (本文に目印を入れるのに名前が要るため。アップロードの完了は待たない)。
   */
  const addFiles = useCallback((files: File[], inlineImages: boolean) => {
    const current = itemsRef.current.filter((i) => i.status !== 'error');
    const check = checkNewAttachments(
      current,
      files.map((f) => ({ name: f.name || 'image.png', size: f.size, type: f.type, file: f })),
    );
    setErrors(check.errors);
    const names = current.map((i) => i.filename);
    const added: MailAttachmentItem[] = check.accepted.map((a) => {
      const filename = uniqueFilename(a.name, names);
      names.push(filename);
      const image = isInlineImageType(a.contentType);
      return {
        key: crypto.randomUUID(),
        filename,
        size: a.size,
        contentType: a.contentType,
        inline: inlineImages && image,
        status: 'uploading',
        previewUrl: image ? URL.createObjectURL(a.file) : undefined,
      };
    });
    if (added.length === 0) return [];
    setItems((prev) => [...prev.filter((i) => i.status !== 'error'), ...added]);
    added.forEach((it, i) => {
      const file = check.accepted[i]?.file;
      if (!file) return;
      void uploadMailAttachment(file, it.filename).then((r) =>
        setItems((prev) =>
          prev.map((p) =>
            p.key === it.key
              ? r.path
                ? { ...p, status: 'done', path: r.path }
                : { ...p, status: 'error', error: r.error }
              : p,
          ),
        ),
      );
    });
    return added;
  }, []);

  const remove = useCallback((key: string) => {
    const it = itemsRef.current.find((i) => i.key === key);
    if (it?.previewUrl) URL.revokeObjectURL(it.previewUrl);
    setItems((prev) => prev.filter((i) => i.key !== key));
    return it;
  }, []);

  const reset = useCallback(() => {
    for (const it of itemsRef.current) if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    setItems([]);
    setErrors([]);
  }, []);

  const uploading = items.some((i) => i.status === 'uploading');
  const submitted: SubmittedAttachment[] = items
    .filter((i) => i.status === 'done' && i.path)
    .map((i) => ({ path: i.path as string, filename: i.filename, inline: i.inline }));

  return { items, errors, uploading, submitted, addFiles, remove, reset };
}

export type MailAttachmentsState = ReturnType<typeof useMailAttachments>;

/** 確認画面に出す「送る添付」(本文中の画像は、送る本文に目印が残っているものだけ) */
export function attachmentsToSend(items: readonly MailAttachmentItem[], body: string) {
  return items
    .filter((i) => i.status === 'done' && (!i.inline || body.includes(inlineMarker(i.filename))))
    .map((i) => ({ filename: i.filename, size: i.size, inline: i.inline }));
}

/** 送信ボタンを押せない理由(アップロード中・失敗した添付が残っている) */
export function attachmentBlockReason(items: readonly MailAttachmentItem[]): string | null {
  if (items.some((i) => i.status === 'uploading'))
    return '添付のアップロードが終わるまでお待ちください';
  if (items.some((i) => i.status === 'error')) return '失敗した添付を外してください';
  return null;
}

/**
 * 本文の欄(textarea)に付けるドラッグ&ドロップ・貼り付けの処理。
 * 画像は本文中の画像としてカーソルの位置に目印を入れ、PDF は通常の添付にする。
 */
export function bodyFileHandlers(
  att: MailAttachmentsState,
  text: string,
  setText: (v: string) => void,
) {
  const insert = (files: File[], el: HTMLTextAreaElement) => {
    const added = att.addFiles(files, true);
    let next = text;
    let cursor = el.selectionStart ?? text.length;
    for (const it of added.filter((a) => a.inline)) {
      const r = insertMarkerAt(next, cursor, inlineMarker(it.filename));
      next = r.text;
      cursor = r.cursor;
    }
    if (next !== text) {
      setText(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(cursor, cursor);
      });
    }
  };
  return {
    onDragOver: (e: DragEvent<HTMLTextAreaElement>) => {
      if (hasFiles(e)) e.preventDefault();
    },
    onDrop: (e: DragEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      insert(files, e.currentTarget);
    },
    onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.clipboardData.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      insert(files, e.currentTarget);
    },
  };
}

/** 添付欄(ボタン・ドロップ先・一覧) */
export function MailAttachmentField({
  att,
  text,
  setText,
  disabled,
}: {
  att: MailAttachmentsState;
  /** 本文(本文中の画像の目印が残っているかの表示と、外したときの目印の削除に使う) */
  text: string;
  setText: (v: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const removeItem = (key: string) => {
    const it = att.remove(key);
    if (it?.inline) setText(removeMarker(text, it.filename));
  };

  return (
    <div className="text-xs">
      <div
        className={`rounded border border-dashed p-2 ${over ? 'border-sky-500 bg-sky-50' : ''}`}
        onDragOver={(e) => {
          if (!hasFiles(e) || disabled) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          if (disabled) return;
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length === 0) return;
          e.preventDefault();
          att.addFiles(files, false);
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            📎 ファイルを添付
          </Button>
          <span className="text-[11px] text-muted-foreground">
            PDF・JPG・PNG(合計 {MAIL_ATTACHMENT_MAX_TOTAL_BYTES / 1024 / 1024}MB・
            {MAIL_ATTACHMENT_MAX_FILES} ファイルまで)。ここにドラッグ&ドロップでも添付できます。
            画像を本文の欄にドラッグ&ドロップ(貼り付け)すると、本文のその位置に表示されます。
          </span>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={MAIL_ATTACHMENT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length > 0) att.addFiles(files, false);
            }}
          />
        </div>

        {att.items.length > 0 && (
          <ul className="mt-2 space-y-1">
            {att.items.map((it) => {
              const missing = it.inline && !text.includes(inlineMarker(it.filename));
              return (
                <li key={it.key} className="flex items-center gap-2">
                  {it.previewUrl ? (
                    <img
                      src={it.previewUrl}
                      alt=""
                      className="h-8 w-8 rounded border object-cover"
                    />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded border text-[10px]">
                      PDF
                    </span>
                  )}
                  <span className="min-w-0 break-all">
                    {it.filename}{' '}
                    <span className="text-muted-foreground">{formatAttachmentSize(it.size)}</span>
                    {it.inline && (
                      <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-800">
                        本文中の画像
                      </span>
                    )}
                    {it.status === 'uploading' && (
                      <span className="ml-1 text-muted-foreground">アップロード中…</span>
                    )}
                    {it.status === 'error' && (
                      <span className="ml-1 text-red-600">
                        {it.error ?? 'アップロードに失敗しました'}
                      </span>
                    )}
                    {missing && it.status !== 'error' && (
                      <span className="ml-1 text-amber-700">
                        本文に目印「{inlineMarker(it.filename)}」が無いため送られません
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    aria-label={`${it.filename} を外す`}
                    className="ml-auto rounded px-1 text-muted-foreground hover:bg-gray-100"
                    disabled={disabled}
                    onClick={() => removeItem(it.key)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {att.errors.length > 0 && (
          <ul className="mt-1 text-red-600">
            {att.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
