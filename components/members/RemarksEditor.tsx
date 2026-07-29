'use client';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { updateMemberRemarks } from '@/lib/domain/member_actions';
import { Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Props {
  memberId: string;
  /** 現在の備考 (未入力なら null) */
  value: string | null;
}

/**
 * 会員詳細の「備考」インライン編集 (全ロール編集可 / migration 71)。
 * 表示モード: 備考テキスト + 鉛筆アイコン。クリックでテキストエリアに切替。
 */
export function RemarksEditor({ memberId, value }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateMemberRemarks(memberId, draft);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  const handleCancel = () => {
    setDraft(value ?? '');
    setError(null);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="group flex min-w-0 items-start gap-1.5">
        <span className={value ? 'whitespace-pre-wrap break-words' : 'text-muted-foreground'}>
          {value ?? '-'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDraft(value ?? '');
            setEditing(true);
          }}
          className="h-6 w-6 shrink-0 p-0 text-slate-400 hover:text-slate-700"
          aria-label="備考を編集"
          title="備考を編集"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        disabled={pending}
        placeholder="備考を入力"
        autoFocus
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSave} disabled={pending} className="h-7 px-3 text-xs">
          {pending ? '保存中…' : '保存'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCancel}
          disabled={pending}
          className="h-7 px-3 text-xs"
        >
          キャンセル
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </div>
  );
}
