'use client';

import {
  type MailFolderGroup,
  type MailFolderItem,
  type MailUserFolderSection,
  expandedDomainForBox,
} from '@/lib/domain/mail_folders';
import { pinMailBox, unpinMailBox } from '@/lib/domain/mail_pin_actions';
import {
  createMailUserFolder,
  deleteMailUserFolder,
  placeMailBoxInFolder,
  removeMailBoxFromFolder,
  renameMailUserFolder,
} from '@/lib/domain/mail_user_folder_actions';
import { cn } from '@/lib/utils/cn';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  FolderPlus,
  GripVertical,
  Import,
  Inbox,
  PanelLeft,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { createContext, useContext, useState, useTransition } from 'react';

/**
 * メーラー左ペイン: 受信箱フォルダ(仕様書 §5.15 / §8.1)。
 *
 * メールディーラーと同じく「ドメイン(会社/ブランド) > アドレス」の階層で受信箱を並べ、
 * 各フォルダに未対応件数を出す。クリックで右の一覧をその受信箱に絞る
 * (`?box=ID`。状態タブは維持し、検索語は解除)。
 * PC では常時表示、モバイルではヘッダーのボタンでドロワー表示。
 */

interface Props {
  groups: MailFolderGroup[];
  total: { pendingCount: number; unreadCount: number };
  /**
   * 「その他(未振り分け)」の件数: 未登録アドレス宛の「その他」受信箱(migration 78)に加え、
   * 自分のマイフォルダに入れていない受信箱のメール(2026-09-16 変更)。受信箱が無ければ null
   */
  unsortedFolder: { pendingCount: number; unreadCount: number } | null;
  /** 「取込候補」(旧「メール to リード」宛先を含むメール。migration 82)の件数 */
  candidateFolder: { pendingCount: number; unreadCount: number };
  /** 自分がピン留めした受信箱(ピン留めした順。migration 84) */
  pinned: MailFolderItem[];
  /** 自分のマイフォルダ(migration 92)。受信箱をドラッグ&ドロップで整理する */
  folders: MailUserFolderSection[];
}

/** ドラッグ中の受信箱(dataTransfer に JSON で載せる) */
interface DragPayload {
  boxId: number;
  /** 元のフォルダ(マイフォルダから掴んだとき)。null = ドメイン一覧・ピン留めから */
  fromFolderId: number | null;
}
const DRAG_MIME = 'application/x-mail-box';

function setDragPayload(e: React.DragEvent, payload: DragPayload) {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = 'move';
}
function readDragPayload(e: React.DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<DragPayload>;
    if (!Number.isInteger(p.boxId)) return null;
    return { boxId: Number(p.boxId), fromFolderId: p.fromFolderId ?? null };
  } catch {
    return null;
  }
}
function isBoxDrag(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(DRAG_MIME);
}

/** ピン留め/解除ボタン(フォルダ行の右端) */
function PinButton({
  pinned,
  disabled,
  onClick,
}: {
  pinned: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={pinned ? 'ピン留めを解除' : 'ピン留め'}
      title={pinned ? 'ピン留めを解除' : 'ピン留めして上部に表示'}
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center rounded hover:bg-accent disabled:opacity-50',
        pinned ? 'text-primary' : 'text-muted-foreground opacity-40 hover:opacity-100',
      )}
    >
      {pinned ? (
        <PinOff className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Pin className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  );
}

/** モバイル用の開閉状態をヘッダーのボタンと共有する */
const SidebarOpenContext = createContext<{
  open: boolean;
  setOpen: (v: boolean) => void;
} | null>(null);

export function MailFolderSidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <SidebarOpenContext.Provider value={{ open, setOpen }}>{children}</SidebarOpenContext.Provider>
  );
}

export function MailFolderToggleButton() {
  const ctx = useContext(SidebarOpenContext);
  if (!ctx) return null;
  return (
    <button
      type="button"
      aria-label="フォルダを開く"
      onClick={() => ctx.setOpen(true)}
      className="grid h-8 w-8 place-items-center rounded hover:bg-white/10 md:hidden"
    >
      <PanelLeft className="h-4 w-4" />
    </button>
  );
}

function CountBadge({ n, strong }: { n: number; strong?: boolean }) {
  if (n <= 0) return null;
  return (
    <span
      className={cn(
        'ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none',
        strong ? 'bg-orange-500 text-white' : 'bg-muted text-muted-foreground',
      )}
    >
      {n > 999 ? '999+' : n}
    </span>
  );
}

function FolderTree({
  groups,
  total,
  unsortedFolder,
  candidateFolder,
  pinned,
  folders,
  onNavigate,
}: Props & { onNavigate?: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentBox = searchParams.get('box') ?? '';
  const currentFolder = searchParams.get('folder') ?? '';
  const onList = pathname === '/mail';
  // ピン留め/解除(Server Action)。完了後はレイアウトが再取得され、pinned が更新される
  const [pinPending, startPin] = useTransition();
  const pinnedIds = new Set(pinned.map((p) => p.id));
  const togglePin = (boxId: number) =>
    startPin(async () => {
      if (pinnedIds.has(boxId)) await unpinMailBox(boxId);
      else await pinMailBox(boxId);
    });

  // --- マイフォルダ(migration 92): 作成・名前変更・削除・ドラッグ&ドロップ ---
  const [folderPending, startFolder] = useTransition();
  const [folderError, setFolderError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [folderCollapsed, setFolderCollapsed] = useState<Record<number, boolean>>({});
  /** ドロップ先の強調表示(フォルダ全体 = 'f:ID'、項目の前 = 'i:フォルダID:受信箱ID') */
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
    runFolder(() => createMailUserFolder(name));
  };
  const submitRename = () => {
    if (!renaming) return;
    const { id, name } = renaming;
    setRenaming(null);
    runFolder(() => renameMailUserFolder(id, name));
  };
  const dropInto = (e: React.DragEvent, folderId: number, beforeBoxId: number | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const p = readDragPayload(e);
    if (!p) return;
    runFolder(() =>
      placeMailBoxInFolder({
        folderId,
        mailBoxId: p.boxId,
        beforeBoxId,
        fromFolderId: p.fromFolderId,
      }),
    );
  };
  const allowDrop = (e: React.DragEvent, key: string) => {
    if (!isBoxDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dropTarget !== key) setDropTarget(key);
  };
  // 開閉状態(true=閉じる)。受信箱が数百件あるため、記録の無いドメインは閉じた扱いにする
  // (=既定はすべて閉じる)。初期表示では選択中の受信箱があるドメインだけ開いておく。
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const domain = expandedDomainForBox(groups, currentBox ? Number(currentBox) : null);
    return domain === null ? {} : { [domain]: false };
  });

  // フォルダを切り替えるとき、状態タブは維持し、検索語・担当などは解除する
  const hrefFor = (boxId: number | null) => {
    const p = new URLSearchParams();
    const tab = searchParams.get('tab');
    if (tab) p.set('tab', tab);
    if (boxId !== null) p.set('box', String(boxId));
    const qs = p.toString();
    return qs ? `/mail?${qs}` : '/mail';
  };
  // 受信箱をまたぐ固定フォルダ(取込候補)。受信箱の指定は外し、状態タブは維持する
  const hrefForFolder = (folder: string) => {
    const p = new URLSearchParams();
    const tab = searchParams.get('tab');
    if (tab) p.set('tab', tab);
    p.set('folder', folder);
    return `/mail?${p.toString()}`;
  };

  const itemClass = (active: boolean) =>
    cn(
      'flex items-center gap-2 rounded px-2 py-1.5 text-sm',
      active ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-accent',
    );

  // ドメインごとのフォルダをまとめて開閉する(個別の開閉状態はそのつど上書き)
  const expandAll = () => setCollapsed(Object.fromEntries(groups.map((g) => [g.domain, false])));
  const collapseAll = () => setCollapsed({});

  return (
    <nav className="space-y-1 p-2 text-sm">
      <Link
        href={hrefFor(null)}
        onClick={onNavigate}
        className={itemClass(onList && currentBox === '' && currentFolder === '')}
      >
        <Inbox className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
        <span className="truncate">すべての受信箱</span>
        <CountBadge n={total.pendingCount} strong />
      </Link>

      <Link
        href={hrefForFolder('candidates')}
        onClick={onNavigate}
        className={itemClass(onList && currentFolder === 'candidates')}
        title="旧「メール to リード」宛先を含むメール(フォーム通知など)。リード/問合せへ取り込む候補を確認するためのフォルダです"
      >
        <Import className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
        <span className="truncate">取込候補</span>
        <CountBadge n={candidateFolder.pendingCount} strong />
      </Link>

      {unsortedFolder && (
        <Link
          href={hrefForFolder('unsorted')}
          onClick={onNavigate}
          className={itemClass(onList && currentFolder === 'unsorted')}
          title="マイフォルダに入れていない受信箱のメールと、まだ受信箱として登録していないアドレス宛のメール"
        >
          <Archive className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
          <span className="truncate">その他(未振り分け)</span>
          <CountBadge n={unsortedFolder.pendingCount} strong />
        </Link>
      )}

      {pinned.length > 0 && (
        <div className="pt-1">
          <p className="flex items-center gap-1 px-1 py-1 text-[11px] font-semibold text-muted-foreground">
            <Pin className="h-3 w-3" aria-hidden="true" />
            ピン留め
          </p>
          <div className="space-y-0.5">
            {pinned.map((b) => {
              const active = onList && currentBox === String(b.id);
              return (
                <div
                  key={`pin-${b.id}`}
                  className="flex items-center gap-0.5"
                  draggable
                  onDragStart={(e) => setDragPayload(e, { boxId: b.id, fromFolderId: null })}
                >
                  <Link
                    href={hrefFor(b.id)}
                    onClick={onNavigate}
                    className={cn(itemClass(active), 'min-w-0 flex-1', !b.isActive && 'opacity-60')}
                    title={b.displayName ? `${b.displayName} <${b.address}>` : b.address}
                  >
                    <span className="truncate">{b.localPart}</span>
                    <span className="truncate text-[10px] text-muted-foreground">
                      @{b.address.split('@')[1] ?? ''}
                    </span>
                    <CountBadge n={b.pendingCount} strong />
                  </Link>
                  <PinButton pinned disabled={pinPending} onClick={() => togglePin(b.id)} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* マイフォルダ: 受信箱をドラッグ&ドロップで自分のフォルダに整理する(migration 92) */}
      <div className="pt-1">
        <div className="flex items-center gap-1 px-1 py-1 text-[11px] font-semibold text-muted-foreground">
          <span>マイフォルダ</span>
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setNewName('');
            }}
            disabled={folderPending}
            className="ml-auto grid h-6 w-6 place-items-center rounded hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label="フォルダを作成"
            title="フォルダを作成"
          >
            <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        {folderError && <p className="px-2 pb-1 text-[11px] text-destructive">{folderError}</p>}
        {creating && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitCreate();
            }}
            className="flex items-center gap-1 px-1 pb-1"
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
              placeholder="フォルダ名"
              maxLength={50}
              className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-xs"
              aria-label="フォルダ名"
            />
            <button
              type="submit"
              className="h-7 rounded bg-primary px-2 text-xs text-primary-foreground"
            >
              作成
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="h-7 rounded px-2 text-xs text-muted-foreground hover:bg-accent"
            >
              取消
            </button>
          </form>
        )}
        {folders.length === 0 && !creating && (
          <p className="px-2 pb-1 text-[11px] text-muted-foreground">
            「+」でフォルダを作り、受信箱をドラッグして入れると、よく見るアドレスを対応ごとにまとめられます。
          </p>
        )}
        <div className="space-y-0.5">
          {folders.map((f) => {
            const isCollapsed = folderCollapsed[f.id] ?? false;
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
                      onClick={() => setFolderCollapsed((c) => ({ ...c, [f.id]: !isCollapsed }))}
                      className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-1.5 text-left text-xs font-semibold hover:bg-accent"
                      aria-expanded={!isCollapsed}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      )}
                      <span className="truncate">{f.name}</span>
                      <span className="text-[10px] font-normal text-muted-foreground">
                        ({f.items.length})
                      </span>
                      {isCollapsed && <CountBadge n={f.pendingCount} strong />}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setRenaming({ id: f.id, name: f.name })}
                    disabled={folderPending}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground opacity-40 hover:bg-accent hover:opacity-100 disabled:opacity-30"
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
                          `フォルダ「${f.name}」を削除します(受信箱そのものは消えません)。よろしいですか?`,
                        )
                      ) {
                        runFolder(() => deleteMailUserFolder(f.id));
                      }
                    }}
                    disabled={folderPending}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground opacity-40 hover:bg-accent hover:text-destructive hover:opacity-100 disabled:opacity-30"
                    aria-label="フォルダを削除"
                    title="フォルダを削除"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
                {!isCollapsed && (
                  <div className="ml-3 space-y-0.5 border-l pl-2">
                    {f.items.length === 0 && (
                      <p className="px-2 py-1 text-[11px] text-muted-foreground">
                        ここに受信箱をドラッグ
                      </p>
                    )}
                    {f.items.map((b) => {
                      const active = onList && currentBox === String(b.id);
                      const itemKey = `i:${f.id}:${b.id}`;
                      return (
                        <div
                          key={`folder-${f.id}-${b.id}`}
                          draggable
                          onDragStart={(e) =>
                            setDragPayload(e, { boxId: b.id, fromFolderId: f.id })
                          }
                          onDragOver={(e) => allowDrop(e, itemKey)}
                          onDrop={(e) => dropInto(e, f.id, b.id)}
                          className={cn(
                            'flex items-center gap-0.5 rounded border-t-2 border-transparent',
                            dropTarget === itemKey && 'border-primary',
                          )}
                        >
                          <GripVertical
                            className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground opacity-40"
                            aria-hidden="true"
                          />
                          <Link
                            href={hrefFor(b.id)}
                            onClick={onNavigate}
                            className={cn(
                              itemClass(active),
                              'min-w-0 flex-1',
                              !b.isActive && 'opacity-60',
                            )}
                            title={b.displayName ? `${b.displayName} <${b.address}>` : b.address}
                          >
                            <span className="truncate">{b.localPart}</span>
                            <span className="truncate text-[10px] text-muted-foreground">
                              @{b.address.split('@')[1] ?? ''}
                            </span>
                            <CountBadge n={b.pendingCount} strong />
                          </Link>
                          <button
                            type="button"
                            onClick={() => runFolder(() => removeMailBoxFromFolder(f.id, b.id))}
                            disabled={folderPending}
                            className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground opacity-40 hover:bg-accent hover:opacity-100 disabled:opacity-30"
                            aria-label="フォルダから外す"
                            title="フォルダから外す"
                          >
                            <X className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {groups.length === 0 && (
        <p className="px-2 py-2 text-xs text-muted-foreground">受信箱が登録されていません。</p>
      )}

      {groups.length > 0 && (
        <div className="flex items-center justify-end gap-2 px-1 pt-1 pb-0.5 text-[11px] text-muted-foreground">
          <button
            type="button"
            onClick={expandAll}
            className="flex items-center gap-0.5 hover:text-foreground hover:underline"
          >
            <ChevronsDown className="h-3 w-3" aria-hidden="true" />
            すべて展開
          </button>
          <span aria-hidden="true">/</span>
          <button
            type="button"
            onClick={collapseAll}
            className="flex items-center gap-0.5 hover:text-foreground hover:underline"
          >
            <ChevronsUp className="h-3 w-3" aria-hidden="true" />
            すべて閉じる
          </button>
        </div>
      )}

      {groups.map((g) => {
        const isCollapsed = collapsed[g.domain] ?? true;
        return (
          <div key={g.domain}>
            <button
              type="button"
              onClick={() => setCollapsed((c) => ({ ...c, [g.domain]: !isCollapsed }))}
              className="flex w-full items-center gap-1 rounded px-1 py-1.5 text-left text-xs font-semibold text-muted-foreground hover:bg-accent"
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span className="truncate">{g.domain || '(ドメインなし)'}</span>
              {isCollapsed && <CountBadge n={g.pendingCount} strong />}
            </button>
            {!isCollapsed && (
              <div className="ml-3 space-y-0.5 border-l pl-2">
                {g.items.map((b) => {
                  const active = onList && currentBox === String(b.id);
                  return (
                    <div
                      key={b.id}
                      className="flex items-center gap-0.5"
                      draggable
                      onDragStart={(e) => setDragPayload(e, { boxId: b.id, fromFolderId: null })}
                    >
                      <Link
                        href={hrefFor(b.id)}
                        onClick={onNavigate}
                        className={cn(
                          itemClass(active),
                          'min-w-0 flex-1',
                          !b.isActive && 'opacity-60',
                        )}
                        title={b.displayName ? `${b.displayName} <${b.address}>` : b.address}
                      >
                        <span className="truncate">{b.localPart}</span>
                        {!b.isActive && (
                          <span className="text-[10px] text-muted-foreground">(停止)</span>
                        )}
                        <CountBadge n={b.pendingCount} strong />
                      </Link>
                      <PinButton
                        pinned={pinnedIds.has(b.id)}
                        disabled={pinPending}
                        onClick={() => togglePin(b.id)}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function MailFolderSidebar(props: Props) {
  const ctx = useContext(SidebarOpenContext);
  const open = ctx?.open ?? false;
  const close = () => ctx?.setOpen(false);

  return (
    <>
      {/* PC: 常時表示 */}
      <aside className="hidden w-60 shrink-0 overflow-y-auto border-r bg-card md:block">
        <FolderTree {...props} />
      </aside>

      {/* モバイル: ドロワー */}
      {open && (
        <div className="fixed inset-0 z-[200] flex md:hidden" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={close}
            onKeyDown={(e) => e.key === 'Escape' && close()}
            role="presentation"
          />
          <div className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col bg-card shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-bold">受信箱</span>
              <button
                type="button"
                onClick={close}
                className="grid h-8 w-8 place-items-center rounded text-muted-foreground hover:bg-accent"
                aria-label="閉じる"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <FolderTree {...props} onNavigate={close} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
