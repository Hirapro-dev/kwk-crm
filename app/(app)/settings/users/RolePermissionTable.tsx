/**
 * ロールの権限表(読み取り専用)。ユーザー一覧の下に開閉式で出す。CLAUDE.md §7.1。
 * 中身は lib/domain/role_permissions.ts(CRM・メーラー・タスク管理)。
 */

import { Card } from '@/components/ui/card';
import {
  PERMISSION_ROLES,
  PERMISSION_ROLE_LABELS,
  type PermissionMark,
  ROLE_PERMISSION_TABLE,
} from '@/lib/domain/role_permissions';
import { cn } from '@/lib/utils/cn';

const MARK_CLASS: Record<PermissionMark, string> = {
  '○': 'text-emerald-700',
  '△': 'text-amber-700',
  '×': 'text-gray-400',
};

export function RolePermissionTable() {
  return (
    <Card className="overflow-hidden p-0 shadow-sm">
      <details>
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold hover:bg-accent">
          ロールの権限表(CRM・メーラー・タスク管理)
        </summary>
        <div className="space-y-1 border-t px-4 py-3">
          <p className="text-xs text-muted-foreground">
            ○ = できる / △ = 条件付き(備考を参照)/ × = できない。権限は DB
            と画面の両方でかけています。この表は説明用で、ここから権限は変えられません。
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr className="border-b bg-gray-50 text-muted-foreground">
                  <th className="px-2 py-2 text-left font-medium">操作</th>
                  {PERMISSION_ROLES.map((r) => (
                    <th key={r} className="w-20 px-2 py-2 text-center font-medium">
                      {PERMISSION_ROLE_LABELS[r]}
                      <div className="font-mono text-[10px] font-normal">{r}</div>
                    </th>
                  ))}
                  <th className="px-2 py-2 text-left font-medium">備考</th>
                </tr>
              </thead>
              {ROLE_PERMISSION_TABLE.map((section) => (
                <tbody key={section.area}>
                  <tr className="border-b bg-sky-50">
                    <td colSpan={PERMISSION_ROLES.length + 2} className="px-2 py-1.5 font-semibold">
                      {section.area}
                    </td>
                  </tr>
                  {section.rows.map((row) => (
                    <tr key={row.action} className="border-b last:border-b-0">
                      <td className="px-2 py-1.5">{row.action}</td>
                      {PERMISSION_ROLES.map((r) => (
                        <td
                          key={r}
                          className={cn(
                            'px-2 py-1.5 text-center text-sm font-semibold',
                            MARK_CLASS[row.marks[r]],
                          )}
                        >
                          {row.marks[r]}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-muted-foreground">{row.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </div>
      </details>
    </Card>
  );
}
