'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { deleteFlowRule, toggleFlowRule } from '@/lib/domain/flow_rule_actions';
import { formatDuration, type FlowRule } from '@/lib/domain/flow_rules';
import { FlowRuleDialog } from './FlowRuleDialog';

interface Props {
  rules: FlowRule[];
}

export function FlowRuleList({ rules }: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<FlowRule | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  const openNew = () => {
    setEditTarget(undefined);
    setDialogOpen(true);
  };

  const openEdit = (rule: FlowRule) => {
    setEditTarget(rule);
    setDialogOpen(true);
  };

  const onToggle = (rule: FlowRule, checked: boolean) => {
    startTransition(async () => {
      await toggleFlowRule(rule.id, checked);
      router.refresh();
    });
  };

  const onDelete = (rule: FlowRule) => {
    if (!confirm(`「${rule.name}」を削除しますか？`)) return;
    startTransition(async () => {
      await deleteFlowRule(rule.id);
      router.refresh();
    });
  };

  return (
    <>
      <div className="flex justify-end">
        <Button size="sm" onClick={openNew} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          新規フロー追加
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="bg-secondary/50 hover:bg-secondary/50">
            <TableHead className="h-9 w-8 text-center">#</TableHead>
            <TableHead className="h-9">フロー名</TableHead>
            <TableHead className="h-9 w-28">トリガー</TableHead>
            <TableHead className="h-9">リセット方法</TableHead>
            <TableHead className="h-9 w-16 text-center">有効</TableHead>
            <TableHead className="h-9 w-20 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                フロールールが登録されていません
              </TableCell>
            </TableRow>
          ) : (
            rules.map((rule) => (
              <TableRow key={rule.id} className="sf-row-hover">
                <TableCell className="py-2 text-center text-xs text-muted-foreground">
                  {rule.sort_order}
                </TableCell>
                <TableCell className="py-2 font-medium">{rule.name}</TableCell>
                <TableCell className="py-2">
                  <Badge variant="outline" className="font-mono text-xs">
                    {rule.trigger_flag}
                  </Badge>
                </TableCell>
                <TableCell className="py-2 text-sm text-muted-foreground">
                  {formatDuration(rule)}
                </TableCell>
                <TableCell className="py-2 text-center">
                  <Switch
                    checked={rule.is_active}
                    onCheckedChange={(v) => onToggle(rule, v)}
                    disabled={pending}
                    aria-label={`${rule.name}を${rule.is_active ? '無効' : '有効'}にする`}
                  />
                </TableCell>
                <TableCell className="py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      aria-label="編集"
                      onClick={() => openEdit(rule)}
                      className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="削除"
                      onClick={() => onDelete(rule)}
                      disabled={pending}
                      className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <FlowRuleDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        rule={editTarget}
      />
    </>
  );
}
