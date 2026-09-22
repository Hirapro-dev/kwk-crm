'use client';

import {
  createTaskUserFolder,
  deleteTaskUserFolder,
  placeTaskProjectInFolder,
  removeTaskProjectFromFolder,
  renameTaskUserFolder,
} from '@/lib/domain/task_folder_actions';
import type { TaskUserFolderSection } from '@/lib/domain/task_pure';
import { cn } from '@/lib/utils/cn';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  GripVertical,
  Home,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * タスク管理の左メニュー(Asana 風。§8.1)。ホーム / マイタスク / マイフォルダ / 参加プロジェクト(閲覧できるプロジェクトの一覧)。
 * マイフォルダ(migration 110)はメーラーと同じ作り: 「+」でフォルダを作り、参加プロジェクトの行をドラッグして入れる。
 * フォルダ内の行にドロップするとその前に差し込み(並び替え)、別フォルダの行を落とすと移動。「×」で外す。
 */
export interface SidebarProject {
  id: number;
  name: string;
  color: string | null;
  visibility: 'public' | 'private';
}

interface Props {
  projects: SidebarProject[];
  folders: TaskUserFolderSection<SidebarProject>[];
  canCreate: boolean;
}

/** ドラッグ中のプロジェクト(dataTransfer に JSON で載せる) */
interface DragPayload {
  projectId: number;
  /** 元のフォルダ(マイフォルダから掴んだとき)。null = 参加プロジェクト一覧から */
  fromFolderId: number | null;
}
const DRAG_MIME = 'application/x-task-project';

function setDragPayload(e: React.DragEvent, payload: DragPayload) {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = 'move';
}
function readDragPayload(e: React.DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<DragPayload>;
    if (!Number.isInteger(p.projectId)) return null;
    return { projectId: Number(p.projectId), fromFolderId: p.fromFolderId ?? null };
  } catch {
    return null;
  }
}
function isProjectDrag(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(DRAG_MIME);
}

function ProjectRow({
  p,
  active,
  onDragStart,
  onDragOver,
  onDrop,
  dropHighlight,
  trailing,
}: {
  p: SidebarProject;
  active: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  dropHighlight?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <div
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        'flex items-center gap-0.5 rounded border-t-2 border-transparent',
        dropHighlight && 'border-primary',
      )}
    >
      {onDragStart && (
        <GripVertical
          className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground opacity-40"
          aria-hidden="true"
        />
      )}
      <Link
        href={`/task/projects/${p.id}`}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-sm hover:bg-black/5',
          active ? 'bg-black/10 font-medium' : 'text-foreground/90',
        )}
        title={p.name}
      >
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: p.color ?? '#94a3b8' }}
        />
        <span className="truncate">{p.name}</span>
        {p.visibility === 'private' && (
          <FolderKanban className="ml-auto h-3 w-3 shrink-0 opacity-50" aria-label="メンバーのみ" />
        )}
      </Link>
      {trailing}
    </div>
  );
}

export function TaskSidebar({ projects, folders, canCreate }: Props) {
  const pathname = usePathname();
  const [folderPending, startFolder] = useTransition();
  const [folderError, setFolderError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const runFolder = (fn: () => Promise<{ error?: string }>) => {
    setFolderError(null);
    startFolder(async () => {
      const r = await fn();
      if (r.error) setFolderError(r.error);
    });
  };
  const submitCreate = () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(false);
    setNewName('');
    runFolder(() => createTaskUserFolder(name));
  };
  const submitRename = () => {
    if (!renaming) return;
    const { id, name } = renaming;
    setRenaming(null);
    runFolder(() => renameTaskUserFolder(id, name));
  };
  const dropInto = (e: React.DragEvent, folderId: number, beforeProjectId: number | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const p = readDragPayload(e);
    if (!p) return;
    runFolder(() =>
      placeTaskProjectInFolder({
        folderId,
        projectId: p.projectId,
        beforeProjectId,
        fromFolderId: p.fromFolderId,
      }),
    );
  };
  const allowDrop = (e: React.DragEvent, key: string) => {
    if (!isProjectDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dropTarget !== key) setDropTarget(key);
  };

  const item = (href: string, label: string, icon: React.ReactNode, exact = false) => {
    const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        href={href}
        className={cn(
          'flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-black/5',
          active ? 'bg-black/10 font-medium' : 'text-foreground/90',
        )}
      >
        {icon}
        {label}
      </Link>
    );
  };
  const isActive = (id: number) => pathname === `/task/projects/${id}`;

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-[#eef0f3] shadow-lg md:w-60 md:shadow-none">
      <nav className="space-y-0.5 p-2">
        {item('/task', 'ホーム', <Home className="h-4 w-4" />, true)}
        {item('/task/my', 'マイタスク', <CheckCircle2 className="h-4 w-4" />)}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* マイフォルダ(migration 110) */}
        <div className="mt-2 flex items-center justify-between px-3">
          <span className="text-xs font-semibold text-muted-foreground">マイフォルダ</span>
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setNewName('');
            }}
            disabled={folderPending}
            className="rounded p-0.5 text-muted-foreground hover:bg-black/10 disabled:opacity-40"
            title="フォルダを作成"
            aria-label="フォルダを作成"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="space-y-0.5 p-2">
          {folderError && <p className="px-2 text-[11px] text-destructive">{folderError}</p>}
          {creating && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitCreate();
              }}
              className="flex items-center gap-1 px-1"
            >
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
                placeholder="フォルダ名"
                maxLength={50}
                className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-xs"
                aria-label="フォルダ名"
                ref={(el) => el?.focus()}
              />
              <button
                type="submit"
                className="h-7 rounded bg-primary px-2 text-xs text-primary-foreground"
              >
                作成
              </button>
            </form>
          )}
          {folders.length === 0 && !creating && (
            <p className="px-2 pb-1 text-[11px] text-muted-foreground">
              「+」でフォルダを作り、参加プロジェクトをドラッグして入れると、よく見るプロジェクトをまとめられます。
            </p>
          )}
          {folders.map((f) => {
            const isCollapsed = collapsed[f.id] ?? false;
            const folderKey = `f:${f.id}`;
            return (
              <div
                key={`folder-${f.id}`}
                onDragOver={(e) => allowDrop(e, folderKey)}
                onDragLeave={() => dropTarget === folderKey && setDropTarget(null)}
                onDrop={(e) => dropInto(e, f.id, null)}
                className={cn(
                  'rounded border border-transparent',
                  dropTarget === folderKey && 'border-primary bg-primary/5',
                )}
              >
                <div className="flex items-center gap-0.5">
                  {renaming?.id === f.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        submitRename();
                      }}
                      className="flex min-w-0 flex-1 items-center gap-1 px-1"
                    >
                      <input
                        value={renaming.name}
                        onChange={(e) => setRenaming({ id: f.id, name: e.target.value })}
                        onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                        maxLength={50}
                        className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-xs"
                        aria-label="フォルダ名"
                        ref={(el) => el?.focus()}
                      />
                      <button
                        type="submit"
                        className="h-7 rounded bg-primary px-2 text-xs text-primary-foreground"
                      >
                        保存
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCollapsed((c) => ({ ...c, [f.id]: !isCollapsed }))}
                      className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-1.5 text-left text-xs font-semibold hover:bg-black/5"
                      aria-expanded={!isCollapsed}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      )}
                      <span className="truncate">{f.name}</span>
                      <span className="text-[10px] font-normal text-muted-foreground">
                        ({f.projects.length})
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setRenaming({ id: f.id, name: f.name })}
                    disabled={folderPending}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground opacity-40 hover:bg-black/10 hover:opacity-100 disabled:opacity-30"
                    aria-label="フォルダ名を変更"
                    title="フォルダ名を変更"
                  >
                    <Pencil className="h-3 w-3" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          `フォルダ「${f.name}」を削除します(プロジェクトそのものは消えません)。よろしいですか?`,
                        )
                      ) {
                        runFolder(() => deleteTaskUserFolder(f.id));
                      }
                    }}
                    disabled={folderPending}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground opacity-40 hover:bg-black/10 hover:text-destructive hover:opacity-100 disabled:opacity-30"
                    aria-label="フォルダを削除"
                    title="フォルダを削除"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
                {!isCollapsed && (
                  <div className="ml-3 space-y-0.5 border-l pl-1">
                    {f.projects.length === 0 && (
                      <p className="px-2 py-1 text-[11px] text-muted-foreground">
                        ここにプロジェクトをドラッグ
                      </p>
                    )}
                    {f.projects.map((p) => {
                      const itemKey = `i:${f.id}:${p.id}`;
                      return (
                        <ProjectRow
                          key={`folder-${f.id}-${p.id}`}
                          p={p}
                          active={isActive(p.id)}
                          onDragStart={(e) =>
                            setDragPayload(e, { projectId: p.id, fromFolderId: f.id })
                          }
                          onDragOver={(e) => allowDrop(e, itemKey)}
                          onDrop={(e) => dropInto(e, f.id, p.id)}
                          dropHighlight={dropTarget === itemKey}
                          trailing={
                            <button
                              type="button"
                              onClick={() =>
                                runFolder(() => removeTaskProjectFromFolder(f.id, p.id))
                              }
                              disabled={folderPending}
                              className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground opacity-40 hover:bg-black/10 hover:opacity-100 disabled:opacity-30"
                              aria-label="フォルダから外す"
                              title="フォルダから外す"
                            >
                              <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 参加プロジェクト */}
        <div className="mt-2 flex items-center justify-between px-3">
          <Link
            href="/task/projects"
            className="text-xs font-semibold text-muted-foreground hover:underline"
          >
            参加プロジェクト
          </Link>
          {canCreate && (
            <Link
              href="/task/projects?new=1"
              className="rounded p-0.5 text-muted-foreground hover:bg-black/10"
              title="プロジェクトを作成"
            >
              <Plus className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
        <nav className="space-y-0.5 p-2">
          {projects.length === 0 && (
            <p className="px-2 text-xs text-muted-foreground">プロジェクトはありません</p>
          )}
          {projects.map((p) => (
            <ProjectRow
              key={p.id}
              p={p}
              active={isActive(p.id)}
              onDragStart={(e) => setDragPayload(e, { projectId: p.id, fromFolderId: null })}
            />
          ))}
        </nav>
      </div>
    </aside>
  );
}
