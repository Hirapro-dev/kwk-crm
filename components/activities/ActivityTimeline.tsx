'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { deleteActivity, updateActivity } from '@/lib/domain/activity_actions';
import type { ActivityListItem } from '@/lib/domain/types';
import { formatDateTime } from '@/lib/utils/date';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

const CONTACT_TYPES = ['アウト', 'イン', 'LINE／メール', '対面接触（個別面談）', 'その他'] as const;
const CONTACT_CONTENTS = ['営業', '営業サポート', 'サポートチーム対応'] as const;

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface EditFormProps {
  activity: ActivityListItem;
  onDone: () => void;
}

function ActivityEditForm({ activity, onDone }: EditFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [dBunrui, setDBunrui] = useState(activity.d_bunrui ?? '');
  const [mBunrui, setMBunrui] = useState(activity.m_bunrui ?? '');
  const [description, setDescription] = useState(activity.description ?? '');
  const [datetimeLocal, setDatetimeLocal] = useState(
    toDatetimeLocal(activity.registered_datetime ?? activity.created_at),
  );

  // s_bunrui をパース
  const flags = (activity.s_bunrui ?? '').split('|');
  const [connected, setConnected] = useState(flags.includes('通電'));
  const [absent, setAbsent] = useState(flags.includes('不在'));
  const [inPerson, setInPerson] = useState(flags.includes('接触対応'));

  useEffect(() => {
    if (dBunrui === 'イン') {
      setConnected(true);
      setAbsent(false);
      setInPerson(false);
    } else if (dBunrui === '対面接触（個別面談）') {
      setConnected(false);
      setAbsent(false);
      setInPerson(true);
    }
  }, [dBunrui]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const sBunrui =
      [connected ? '通電' : '', absent ? '不在' : '', inPerson ? '接触対応' : '']
        .filter(Boolean)
        .join('|') || undefined;

    startTransition(async () => {
      const res = await updateActivity(activity.id, {
        member_id: activity.member_id ?? undefined,
        d_bunrui: dBunrui,
        m_bunrui: mBunrui || undefined,
        s_bunrui: sBunrui,
        description: description || undefined,
        registered_at_local: datetimeLocal || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? '更新に失敗しました');
        return;
      }
      router.refresh();
      onDone();
    });
  };

  return (
    <TableRow>
      <TableCell colSpan={8} className="bg-accent/30 p-3">
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1">
              <label className="text-xs font-medium">接触種別 *</label>
              <Select value={dBunrui} onChange={(e) => setDBunrui(e.target.value)} required>
                <option value="">選択</option>
                {CONTACT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">接触内容</label>
              <Select value={mBunrui} onChange={(e) => setMBunrui(e.target.value)}>
                <option value="">選択</option>
                {CONTACT_CONTENTS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">状態</label>
              <div className="flex gap-3 pt-1">
                {[
                  {
                    label: '通電',
                    val: connected,
                    set: (v: boolean) => {
                      setConnected(v);
                      if (v) setAbsent(false);
                    },
                    disabled: dBunrui !== 'アウト',
                  },
                  {
                    label: '不在',
                    val: absent,
                    set: (v: boolean) => {
                      setAbsent(v);
                      if (v) setConnected(false);
                    },
                    disabled: dBunrui !== 'アウト',
                  },
                  { label: '接触対応', val: inPerson, set: () => {}, disabled: true },
                ].map(({ label, val, set, disabled }) => (
                  <label
                    key={label}
                    className={`flex items-center gap-1 text-xs ${disabled ? 'text-muted-foreground' : 'cursor-pointer'}`}
                  >
                    <input
                      type="checkbox"
                      checked={val}
                      disabled={disabled}
                      onChange={(e) => set(e.target.checked)}
                      className="h-3 w-3"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">日時</label>
              <Input
                type="datetime-local"
                value={datetimeLocal}
                onChange={(e) => setDatetimeLocal(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">対応詳細</label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="text-sm"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? '更新中…' : '保存'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onDone} disabled={pending}>
              キャンセル
            </Button>
          </div>
        </form>
      </TableCell>
    </TableRow>
  );
}

interface Props {
  activities: ActivityListItem[];
  currentUserId: string;
  currentUserRole: string;
  /** 会員名列(会員詳細へのリンク)を表示するか。ダッシュボード・直近一覧で使用 */
  showMember?: boolean;
  /** 分割ビュー: 会員名クリックで詳細ページに遷移せず、右ペインに詳細を出す(URL の selected を差し替え) */
  splitMode?: boolean;
  /** 分割ビューで現在選択中の会員ID(選択行ハイライト用) */
  selectedMemberId?: string;
}

export function ActivityTimeline({
  activities,
  currentUserId,
  currentUserRole,
  showMember = false,
  splitMode = false,
  selectedMemberId,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleting, startDelete] = useTransition();

  // 分割ビュー用: 現在のクエリを維持したまま selected を差し替えるリンク先を作る
  const buildSelectHref = (memberId: string) => {
    const p = new URLSearchParams(searchParams?.toString() ?? '');
    p.set('view', 'split');
    p.set('selected', memberId);
    return `${pathname}?${p.toString()}`;
  };

  const canEdit = (a: ActivityListItem) =>
    currentUserRole === 'admin' || a.created_by_id === currentUserId;
  // 削除は管理者のみ(論理削除)。
  const canDelete = currentUserRole === 'admin';

  const hasAnyEditable = activities.some(canEdit);

  const onDelete = (id: number) => {
    if (!window.confirm('この対応歴を削除します。よろしいですか？')) return;
    startDelete(async () => {
      const res = await deleteActivity(id);
      if (!res.ok) {
        window.alert(res.error ?? '削除に失敗しました');
        return;
      }
      router.refresh();
    });
  };

  if (activities.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">対応歴はありません</p>;
  }

  return (
    <div className="w-full overflow-x-auto">
      <Table className="min-w-[860px]">
        <TableHeader>
          <TableRow className="bg-gray-50 hover:bg-gray-50">
            <TableHead className="h-9 whitespace-nowrap">日時</TableHead>
            {showMember && <TableHead className="h-9 whitespace-nowrap">会員</TableHead>}
            <TableHead className="h-9 whitespace-nowrap">対応者</TableHead>
            <TableHead className="h-9 whitespace-nowrap">接触種別</TableHead>
            <TableHead className="h-9 whitespace-nowrap">接触内容</TableHead>
            <TableHead className="h-9 whitespace-nowrap">状態</TableHead>
            <TableHead className="h-9 w-full">対応詳細</TableHead>
            {hasAnyEditable && <TableHead className="h-9 whitespace-nowrap" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {activities.map((a) => {
            const ts = a.registered_datetime ?? a.created_at;
            const description = a.description ?? '';
            const editing = editingId === a.id;
            return (
              <>
                <TableRow
                  key={a.id}
                  className={
                    splitMode && selectedMemberId && a.member?.id === selectedMemberId
                      ? 'sf-row-hover bg-primary/10'
                      : 'sf-row-hover'
                  }
                >
                  <TableCell className="whitespace-nowrap py-2 text-xs">
                    <time dateTime={ts}>{formatDateTime(ts)}</time>
                  </TableCell>
                  {showMember && (
                    <TableCell className="whitespace-nowrap py-2 text-sm">
                      {a.member?.id ? (
                        <Link
                          href={splitMode ? buildSelectHref(a.member.id) : `/members/${a.member.id}`}
                          scroll={!splitMode}
                          replace={splitMode}
                          className="text-primary hover:underline"
                        >
                          {a.member.name ?? a.member.id}
                        </Link>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                  )}
                  <TableCell className="whitespace-nowrap py-2 text-sm">
                    {a.owner?.full_name ?? '-'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2 text-sm">
                    {a.d_bunrui ?? '-'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2 text-sm">
                    {a.m_bunrui ?? '-'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2 text-sm">
                    {a.s_bunrui ?? '-'}
                  </TableCell>
                  <TableCell className="py-2 text-sm text-muted-foreground">
                    {description || '-'}
                  </TableCell>
                  {hasAnyEditable && (
                    <TableCell className="py-2">
                      {!editing && (
                        <div className="flex gap-1">
                          {canEdit(a) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs"
                              onClick={() => setEditingId(a.id)}
                            >
                              編集
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs text-destructive hover:bg-destructive/10"
                              disabled={deleting}
                              onClick={() => onDelete(a.id)}
                            >
                              削除
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
                {editing && (
                  <ActivityEditForm
                    key={`edit-${a.id}`}
                    activity={a}
                    onDone={() => setEditingId(null)}
                  />
                )}
              </>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
