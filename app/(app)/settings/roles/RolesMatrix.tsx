'use client';

/**
 * ロール管理マトリクス (メニュー項目 × ロール のチェックボックス)。
 * 「全ロール」ONで visible_roles=null(全員表示)、OFFでロール別チェックが有効。
 * 保存は saveNavRoles(admin 限定 Server Action)。
 */

import { Button } from '@/components/ui/button';
import { type NavRoleSaveItem, saveNavRoles } from '@/lib/domain/nav_actions';
import type { NavItem } from '@/lib/domain/nav_items';
import { Loader2, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

const ROLES: Array<{ key: string; label: string }> = [
  { key: 'admin', label: '管理者' },
  { key: 'manager', label: 'マネージャ' },
  { key: 'sales', label: '営業' },
  { key: 'support', label: 'サポート' },
  { key: 'viewer', label: '閲覧' },
];

interface RowState {
  /** true = 全ロール表示(visible_roles=null) */
  allRoles: boolean;
  roles: Set<string>;
}

export function RolesMatrix({ items }: { items: NavItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const [state, setState] = useState<Map<string, RowState>>(() => {
    const m = new Map<string, RowState>();
    for (const it of items) {
      const vr = it.visible_roles ?? null;
      m.set(it.id, {
        allRoles: vr === null || vr.length === 0,
        roles: new Set(vr ?? ROLES.map((r) => r.key)),
      });
    }
    return m;
  });

  const setRow = (id: string, updater: (cur: RowState) => RowState) => {
    setState((prev) => {
      const next = new Map(prev);
      const cur = next.get(id);
      if (cur) next.set(id, updater(cur));
      return next;
    });
  };

  const onSave = () => {
    setMessage(null);
    const payload: NavRoleSaveItem[] = items.map((it) => {
      const row = state.get(it.id);
      if (!row || row.allRoles) return { id: it.id, visible_roles: null };
      return { id: it.id, visible_roles: [...row.roles] };
    });
    startTransition(async () => {
      const res = await saveNavRoles(payload);
      setMessage(res.ok ? (res.message ?? '保存しました') : (res.error ?? '保存に失敗しました'));
      if (res.ok) router.refresh();
    });
  };

  // 親→その子 の順に並べる(インデント表示のため)
  const topLevel = items.filter((i) => !i.parent_id);
  const childrenOf = (id: string) => items.filter((i) => i.parent_id === id);
  const ordered: Array<{ item: NavItem; depth: number }> = [];
  for (const t of topLevel) {
    ordered.push({ item: t, depth: 0 });
    for (const c of childrenOf(t.id)) ordered.push({ item: c, depth: 1 });
  }

  return (
    <div className="p-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">メニュー項目</th>
              <th className="px-3 py-2 text-center font-medium">全ロール</th>
              {ROLES.map((r) => (
                <th key={r.key} className="px-3 py-2 text-center font-medium">
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ordered.map(({ item, depth }) => {
              const row = state.get(item.id);
              if (!row) return null;
              return (
                <tr key={item.id} className="border-b">
                  <td className="px-3 py-2">
                    <span style={{ paddingLeft: depth * 16 }}>
                      {depth > 0 && <span className="mr-1 text-muted-foreground">└</span>}
                      {item.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={row.allRoles}
                      onChange={(e) =>
                        setRow(item.id, (cur) => ({ ...cur, allRoles: e.target.checked }))
                      }
                      aria-label={`${item.label} を全ロールに表示`}
                    />
                  </td>
                  {ROLES.map((r) => (
                    <td key={r.key} className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={row.allRoles || row.roles.has(r.key)}
                        disabled={row.allRoles}
                        onChange={(e) =>
                          setRow(item.id, (cur) => {
                            const roles = new Set(cur.roles);
                            if (e.target.checked) roles.add(r.key);
                            else roles.delete(r.key);
                            return { ...cur, roles };
                          })
                        }
                        aria-label={`${item.label} を ${r.label} に表示`}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" onClick={onSave} disabled={pending} className="gap-1.5">
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          保存
        </Button>
        {message && <p className="text-xs text-muted-foreground">{message}</p>}
      </div>
    </div>
  );
}
