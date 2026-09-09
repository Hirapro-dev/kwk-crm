'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { updateMailBoxDisplayName } from '@/lib/domain/mail_box_actions';
import type { MailBox } from '@/lib/domain/mail_types';
import { Pencil, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * 受信箱1行分(閲覧 ↔ 編集の切替を内部で持つ)。案件マスタの ProjectRow と同じ方式。
 * 編集できるのは差出人表示名のみ(アドレス・有効状態はここでは変更しない)。
 */
export function MailBoxDisplayNameRow({
  box,
  sendable,
}: {
  box: MailBox;
  sendable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(box.display_name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateMailBoxDisplayName({ id: box.id, displayName: name });
      if (res.error) {
        setError(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  const onCancel = () => {
    setName(box.display_name ?? '');
    setError(null);
    setEditing(false);
  };

  const sendBadge = sendable ? (
    <Badge variant="outline" className="text-[10px] text-emerald-700">
      送信可
    </Badge>
  ) : (
    <Badge variant="outline" className="text-[10px] text-muted-foreground">
      受信専用
    </Badge>
  );

  if (!editing) {
    return (
      <TableRow className="sf-row-hover">
        <TableCell className="py-2 font-mono text-xs">{box.address}</TableCell>
        <TableCell className="py-2">
          {box.display_name || <span className="text-muted-foreground">(未設定)</span>}
        </TableCell>
        <TableCell className="py-2 text-center">{sendBadge}</TableCell>
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
      <TableCell className="py-2 font-mono text-xs">{box.address}</TableCell>
      <TableCell className="py-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="例: ひらプロ"
          aria-label="差出人表示名"
        />
      </TableCell>
      <TableCell className="py-2 text-center">{sendBadge}</TableCell>
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
