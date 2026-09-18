'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { updateMailSignature } from '@/lib/domain/mail_signature_actions';
import { MAX_SIGNATURE_NAME_CHARS } from '@/lib/domain/mail_signatures';
import type { MailSignature } from '@/lib/domain/mail_types';
import { Pencil, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * 署名マスタの 1 行分(閲覧 ↔ 編集の切替を内部で持つ)。受信箱の MailBoxRow と同じ方式。
 * 編集できるのは名前・本文・有効/無効。削除はしない(受信箱の既定署名が参照するため無効化で代替)。
 */
export function MailSignatureRow({
  signature,
  usedByCount,
}: {
  signature: MailSignature;
  /** この署名を既定にしている受信箱の数 */
  usedByCount: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(signature.name);
  const [body, setBody] = useState(signature.body);
  const [isActive, setIsActive] = useState(signature.is_active);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateMailSignature({ id: signature.id, name, body, isActive });
      if (res.error) {
        setError(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  const onCancel = () => {
    setName(signature.name);
    setBody(signature.body);
    setIsActive(signature.is_active);
    setError(null);
    setEditing(false);
  };

  if (!editing) {
    return (
      <TableRow className={signature.is_active ? 'sf-row-hover' : 'sf-row-hover opacity-60'}>
        <TableCell className="py-2 text-sm">{signature.name}</TableCell>
        <TableCell className="max-w-[420px] py-2 text-xs text-muted-foreground">
          <span className="line-clamp-3 whitespace-pre-wrap" title={signature.body}>
            {signature.body}
          </span>
        </TableCell>
        <TableCell className="py-2 text-center text-xs text-muted-foreground">
          {usedByCount > 0 ? `${usedByCount} 件` : '—'}
        </TableCell>
        <TableCell className="py-2 text-center">
          <input type="checkbox" checked={signature.is_active} disabled aria-label="有効" />
        </TableCell>
        <TableCell className="py-2 text-right">
          <button
            type="button"
            aria-label="編集"
            onClick={() => setEditing(true)}
            className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow className="bg-accent/30">
      <TableCell className="py-2 align-top">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_SIGNATURE_NAME_CHARS}
          placeholder="例: 営業部 共通"
          aria-label="署名名"
        />
      </TableCell>
      <TableCell className="py-2">
        <Textarea
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={'例:\n株式会社〇〇 サポート\nTEL 00-0000-0000'}
          aria-label="署名の本文"
        />
      </TableCell>
      <TableCell className="py-2 text-center text-xs text-muted-foreground">
        {usedByCount > 0 ? `${usedByCount} 件` : '—'}
      </TableCell>
      <TableCell className="py-2 text-center">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          aria-label="有効"
        />
      </TableCell>
      <TableCell className="py-2 text-right">
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-1">
            <Button size="sm" onClick={onSave} disabled={pending}>
              {pending ? '...' : '保存'}
            </Button>
            <button
              type="button"
              aria-label="キャンセル"
              onClick={onCancel}
              disabled={pending}
              className="grid h-7 w-7 place-items-center rounded border border-input text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {error && <span className="text-[11px] text-destructive">{error}</span>}
        </div>
      </TableCell>
    </TableRow>
  );
}
