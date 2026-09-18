'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { TableCell, TableRow } from '@/components/ui/table';
import { updateMailBox } from '@/lib/domain/mail_box_actions';
import type { MailBox, MailSignature } from '@/lib/domain/mail_types';
import type { DomainIdentityStatus } from '@/lib/mail/ses_identity';
import { Pencil, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * 受信箱1行分(閲覧 ↔ 編集の切替を内部で持つ)。案件マスタの ProjectRow と同じ方式。
 * 編集できるのは表示名・既定の署名(署名マスタから選択)・有効/無効。アドレスは受信判定キーのため変更不可(表示のみ)。
 */
export function MailBoxRow({
  box,
  domainStatus,
  signatures,
}: {
  box: MailBox;
  domainStatus: DomainIdentityStatus;
  /** 署名マスタ(無効化済みも含む。選択肢は有効なもの + 現在の既定) */
  signatures: MailSignature[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(box.display_name ?? '');
  const [signatureId, setSignatureId] = useState<string>(
    box.default_signature_id != null ? String(box.default_signature_id) : '',
  );
  const [isActive, setIsActive] = useState(box.is_active);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateMailBox({
        id: box.id,
        displayName: name,
        defaultSignatureId: signatureId ? Number(signatureId) : null,
        isActive,
      });
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
    setSignatureId(box.default_signature_id != null ? String(box.default_signature_id) : '');
    setIsActive(box.is_active);
    setError(null);
    setEditing(false);
  };

  const currentSignature = signatures.find((s) => s.id === box.default_signature_id) ?? null;
  // 選択肢は有効な署名。現在の既定が無効化済みでも、その値は選択肢に残して失わない
  const selectableSignatures = signatures.filter(
    (s) => s.is_active || s.id === box.default_signature_id,
  );

  const sendBadge =
    domainStatus === 'verified' && box.is_active ? (
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
      <TableRow className={box.is_active ? 'sf-row-hover' : 'sf-row-hover opacity-60'}>
        <TableCell className="py-2 font-mono text-xs">{box.address}</TableCell>
        <TableCell className="py-2 text-sm">
          {box.display_name || <span className="text-muted-foreground">(未設定)</span>}
        </TableCell>
        <TableCell className="max-w-[260px] py-2 text-xs text-muted-foreground">
          {currentSignature ? (
            <span title={currentSignature.body}>
              {currentSignature.name}
              {currentSignature.is_active ? '' : '(無効)'}
            </span>
          ) : (
            '(なし)'
          )}
        </TableCell>
        <TableCell className="py-2 text-center">
          <input type="checkbox" checked={box.is_active} disabled aria-label="有効" />
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
      <TableCell className="py-2">
        <Select
          aria-label="既定の署名"
          value={signatureId}
          onChange={(e) => setSignatureId(e.target.value)}
        >
          <option value="">署名なし</option>
          {selectableSignatures.map((s) => (
            <option key={s.id} value={String(s.id)}>
              {s.name}
              {s.is_active ? '' : '(無効)'}
            </option>
          ))}
        </Select>
      </TableCell>
      <TableCell className="py-2 text-center">
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          aria-label="有効"
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
