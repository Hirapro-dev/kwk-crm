'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { createField } from '@/lib/domain/object_metadata_actions';

const DATA_TYPES = ['text', 'number', 'date', 'datetime', 'boolean', 'enum', 'jsonb'] as const;
type DataType = (typeof DATA_TYPES)[number];

/**
 * カスタムフィールド追加フォーム。
 * 折りたたみ式 (初期は「+ 新規フィールドを追加」ボタンのみ)。
 *
 * 追加されたフィールドは is_custom=true でマークされる。
 *
 * ⚠ Phase 1 注意:
 *   DB の物理カラムは追加しません。あくまでメタデータ管理のみ。
 *   実画面への反映 + CSV取込での自動追加は Phase 2 以降。
 */
export function NewFieldForm({ objectId }: { objectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fieldName, setFieldName] = useState('');
  const [label, setLabel] = useState('');
  const [dataType, setDataType] = useState<DataType>('text');
  const [visibleList, setVisibleList] = useState(true);
  const [visibleDetail, setVisibleDetail] = useState(true);
  const [description, setDescription] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setFieldName('');
    setLabel('');
    setDataType('text');
    setVisibleList(true);
    setVisibleDetail(true);
    setDescription('');
    setMsg(null);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    startTransition(async () => {
      const res = await createField({
        object_id: objectId,
        field_name: fieldName.trim(),
        label: label.trim() || undefined,
        data_type: dataType,
        is_visible_list: visibleList,
        is_visible_detail: visibleDetail,
        description: description.trim() || undefined,
      });
      if (!res.ok) {
        setMsg({ type: 'err', text: res.error ?? '失敗' });
        return;
      }
      setMsg({ type: 'ok', text: res.message ?? '追加しました' });
      reset();
      router.refresh();
    });
  };

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        新規フィールドを追加
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader className="border-b py-3">
        <CardTitle className="text-sm">新規フィールドを追加 (メタデータのみ)</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="nf-name">フィールド名 *</Label>
              <Input
                id="nf-name"
                value={fieldName}
                onChange={(e) => setFieldName(e.target.value)}
                placeholder="例: extra_memo"
                required
                pattern="[a-zA-Z_][a-zA-Z0-9_]*"
                title="半角英数+アンダースコアのみ"
              />
              <p className="text-xs text-muted-foreground">
                半角英数+アンダースコアのみ
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="nf-label">表示ラベル</Label>
              <Input
                id="nf-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="例: 補足メモ"
                maxLength={100}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="nf-type">データ型</Label>
              <Select
                id="nf-type"
                value={dataType}
                onChange={(e) => setDataType(e.target.value as DataType)}
              >
                {DATA_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={visibleList}
                onChange={(e) => setVisibleList(e.target.checked)}
              />
              一覧に表示
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={visibleDetail}
                onChange={(e) => setVisibleDetail(e.target.checked)}
              />
              詳細に表示
            </label>
          </div>

          <div className="space-y-1">
            <Label htmlFor="nf-desc">説明 (任意)</Label>
            <Textarea
              id="nf-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </div>

          {msg && (
            <p
              role={msg.type === 'err' ? 'alert' : 'status'}
              className={
                msg.type === 'err'
                  ? 'text-sm text-destructive'
                  : 'text-sm text-green-700'
              }
            >
              {msg.text}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                reset();
              }}
              disabled={pending}
            >
              閉じる
            </Button>
            <Button type="submit" disabled={pending || !fieldName.trim()}>
              {pending ? '追加中…' : '追加'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
