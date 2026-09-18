'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { createTaskProject, deleteTaskProject, updateTaskProject } from '@/lib/domain/task_actions';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * プロジェクトの作成・設定ダイアログ(§5.20)。名前・色・説明・公開範囲・メンバー(非公開のとき)・アーカイブ・削除(作成者と admin。論理削除でタスクも消える)。
 * `project` を渡すと設定モード(作成者と admin だけが開ける。権限はサーバー側でも確認)。
 */
export interface TaskProjectFormValue {
  id: number;
  name: string;
  color: string | null;
  description: string | null;
  visibility: 'public' | 'private';
  is_archived: boolean;
  memberIds: string[];
}

const COLORS = [
  '#f97316',
  '#ef4444',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#64748b',
];

export function NewTaskProjectDialog({
  users,
  currentUserId,
  project,
  triggerLabel,
  defaultOpen = false,
}: {
  users: Array<{ id: string; full_name: string | null }>;
  currentUserId: string;
  project?: TaskProjectFormValue;
  /** 開くボタンの文言(既定は「プロジェクトを作成」。設定モードでは「設定」など) */
  triggerLabel?: string;
  /** 最初から開いた状態にする(左メニューの「＋」から /task/projects?new=1 で来たとき) */
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(project?.name ?? '');
  const [color, setColor] = useState(project?.color ?? COLORS[0]);
  const [description, setDescription] = useState(project?.description ?? '');
  const [visibility, setVisibility] = useState<'public' | 'private'>(
    project?.visibility ?? 'public',
  );
  const [members, setMembers] = useState<Set<string>>(
    new Set(project?.memberIds ?? [currentUserId]),
  );
  const [archived, setArchived] = useState(project?.is_archived ?? false);

  const toggleMember = (id: string) =>
    setMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const memberIds = [...members];
      if (project) {
        const r = await updateTaskProject({
          id: project.id,
          name,
          color,
          description,
          visibility,
          is_archived: archived,
          memberIds: visibility === 'private' ? memberIds : [],
        });
        if (r.error) {
          setError(r.error);
          return;
        }
        setOpen(false);
        router.refresh();
        return;
      }
      const r = await createTaskProject({ name, color, description, visibility, memberIds });
      if (r.error || !r.data) {
        setError(r.error ?? '作成に失敗しました');
        return;
      }
      setOpen(false);
      router.push(`/task/projects/${r.data.id}`);
    });
  };

  return (
    <>
      <Button size="sm" variant={project ? 'outline' : 'default'} onClick={() => setOpen(true)}>
        {!project && <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
        {triggerLabel ?? 'プロジェクトを作成'}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && !pending && setOpen(false)}>
        <DialogContent className="max-w-[92%] sm:max-w-[560px]" onClose={() => setOpen(false)}>
          <DialogHeader>
            <DialogTitle>{project ? 'プロジェクトの設定' : 'プロジェクトを作成'}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-3 overflow-y-auto p-1 text-sm">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">プロジェクト名(必須)</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">色</Label>
              <div className="flex flex-wrap gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    onClick={() => setColor(c)}
                    className={`h-6 w-6 rounded-full border-2 ${color === c ? 'border-slate-900' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">説明</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">公開範囲</Label>
              <Select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
              >
                <option value="public">全員が閲覧できる</option>
                <option value="private">メンバーのみ</option>
              </Select>
            </div>
            {visibility === 'private' && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  メンバー(自分は常に含まれます)
                </Label>
                <div className="max-h-48 overflow-y-auto rounded border p-2">
                  {users.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 py-0.5 text-sm">
                      <input
                        type="checkbox"
                        checked={members.has(u.id) || u.id === currentUserId}
                        disabled={u.id === currentUserId}
                        onChange={() => toggleMember(u.id)}
                      />
                      {u.full_name ?? u.id}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {project && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={archived}
                  onChange={(e) => setArchived(e.target.checked)}
                />
                アーカイブする(一覧から隠す。タスクは残ります)
              </label>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter className="sm:justify-between">
            {project ? (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={pending}
                onClick={() => {
                  if (
                    !confirm(
                      `プロジェクト「${project.name}」を削除しますか?\n中のタスク(サブタスク・コメント・添付を含む)も見えなくなります。`,
                    )
                  )
                    return;
                  setError(null);
                  startTransition(async () => {
                    const r = await deleteTaskProject(project.id);
                    if (r.error) {
                      setError(r.error);
                      return;
                    }
                    setOpen(false);
                    router.push('/task/projects');
                    router.refresh();
                  });
                }}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                プロジェクトを削除
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                キャンセル
              </Button>
              <Button onClick={submit} disabled={pending || !name.trim()}>
                {pending ? '保存中…' : project ? '保存' : '作成'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
