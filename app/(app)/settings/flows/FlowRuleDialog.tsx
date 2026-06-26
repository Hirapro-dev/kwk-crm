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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { type FlowRuleInput, upsertFlowRule } from '@/lib/domain/flow_rule_actions';
import {
  type DurationType,
  FLOW_RULE_ROLES,
  type FlowRule,
  ROLE_LABELS,
} from '@/lib/domain/flow_rules_types';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  rule?: FlowRule; // 未指定 = 新規
}

const DEFAULT_FORM: FlowRuleInput = {
  name: '',
  trigger_flag: '',
  duration_type: 'days_at_time',
  duration_value: 7,
  reset_hour: 2,
  reset_minute: 0,
  is_active: true,
  sort_order: 100,
  apply_roles: [],
};

export function FlowRuleDialog({ open, onClose, rule }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FlowRuleInput>(() =>
    rule
      ? {
          name: rule.name,
          trigger_flag: rule.trigger_flag,
          duration_type: rule.duration_type,
          duration_value: rule.duration_value,
          reset_hour: rule.reset_hour,
          reset_minute: rule.reset_minute,
          is_active: rule.is_active,
          sort_order: rule.sort_order,
          apply_roles: (rule.apply_roles ?? []) as FlowRuleInput['apply_roles'],
        }
      : { ...DEFAULT_FORM },
  );

  const toggleRole = (role: FlowRuleInput['apply_roles'][number]) =>
    setForm((prev) => ({
      ...prev,
      apply_roles: prev.apply_roles.includes(role)
        ? prev.apply_roles.filter((r) => r !== role)
        : [...prev.apply_roles, role],
    }));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof FlowRuleInput>(key: K, value: FlowRuleInput[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const onSave = () => {
    setError(null);
    startTransition(async () => {
      const res = await upsertFlowRule(rule?.id ?? null, form);
      if (!res.ok) {
        setError(res.error ?? '保存に失敗しました');
        return;
      }
      router.refresh();
      onClose();
    });
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) onClose();
  };

  const durationLabel =
    form.duration_type === 'hours'
      ? `${form.duration_value}時間後に自動リセット`
      : `${form.duration_value}日後の${String(form.reset_hour).padStart(2, '0')}:${String(form.reset_minute).padStart(2, '0')} に自動リセット`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{rule ? 'フロー編集' : '新規フロー追加'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* フロー名 */}
          <div className="space-y-1">
            <Label htmlFor="fr-name">フロー名</Label>
            <Input
              id="fr-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="例: 通電プロテクト"
              maxLength={100}
            />
          </div>

          {/* トリガーフラグ */}
          <div className="space-y-1">
            <Label htmlFor="fr-trigger">トリガー (対応歴の状態フラグ)</Label>
            <Input
              id="fr-trigger"
              value={form.trigger_flag}
              onChange={(e) => set('trigger_flag', e.target.value)}
              placeholder="例: 通電"
              maxLength={50}
            />
            <p className="text-[11px] text-muted-foreground">
              対応歴入力フォームの「状態」チェックボックスに表示される値と一致させてください。
            </p>
          </div>

          {/* リセット方法 */}
          <div className="space-y-2">
            <Label>リセット方法</Label>
            <RadioGroup
              value={form.duration_type}
              onValueChange={(v) => set('duration_type', v as DurationType)}
              className="space-y-2"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="days_at_time" id="dr-days" />
                <Label htmlFor="dr-days" className="cursor-pointer font-normal">
                  N日後の HH:MM に自動リセット
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="hours" id="dr-hours" />
                <Label htmlFor="dr-hours" className="cursor-pointer font-normal">
                  N時間後に自動リセット
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* 日数/時間数 */}
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <Label htmlFor="fr-val">{form.duration_type === 'hours' ? '時間数' : '日数'}</Label>
              <Input
                id="fr-val"
                type="number"
                min={1}
                value={form.duration_value}
                onChange={(e) => set('duration_value', Number(e.target.value))}
                className="w-24"
              />
            </div>

            {/* days_at_time のみ: リセット時刻 */}
            {form.duration_type === 'days_at_time' && (
              <div className="flex items-end gap-1">
                <div className="space-y-1">
                  <Label htmlFor="fr-hour">時 (JST)</Label>
                  <Input
                    id="fr-hour"
                    type="number"
                    min={0}
                    max={23}
                    value={form.reset_hour}
                    onChange={(e) => set('reset_hour', Number(e.target.value))}
                    className="w-16"
                  />
                </div>
                <span className="mb-2 text-sm">:</span>
                <div className="space-y-1">
                  <Label htmlFor="fr-min">分</Label>
                  <Input
                    id="fr-min"
                    type="number"
                    min={0}
                    max={59}
                    step={5}
                    value={form.reset_minute}
                    onChange={(e) => set('reset_minute', Number(e.target.value))}
                    className="w-16"
                  />
                </div>
              </div>
            )}
          </div>

          {/* プレビュー */}
          <p className="rounded bg-muted px-3 py-2 text-sm font-medium text-muted-foreground">
            設定: {durationLabel}
          </p>

          {/* 並び順 */}
          <div className="space-y-1">
            <Label htmlFor="fr-sort">並び順</Label>
            <Input
              id="fr-sort"
              type="number"
              min={0}
              value={form.sort_order}
              onChange={(e) => set('sort_order', Number(e.target.value))}
              className="w-24"
            />
          </div>

          {/* 適用ロール */}
          <div className="space-y-2">
            <Label>適用ロール</Label>
            <div className="flex flex-wrap gap-3">
              {FLOW_RULE_ROLES.map((role) => (
                <label key={role} className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={form.apply_roles.includes(role)}
                    onChange={() => toggleRole(role)}
                    className="h-3.5 w-3.5"
                  />
                  {ROLE_LABELS[role] ?? role}
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              選択したロールのユーザーが対応歴を残した時のみプロテクトを適用します。
              {form.apply_roles.length === 0 && ' (未選択 = すべてのロールに適用)'}
            </p>
          </div>

          {/* 有効フラグ */}
          <div className="flex items-center gap-3">
            <Switch
              id="fr-active"
              checked={form.is_active}
              onCheckedChange={(v) => set('is_active', v)}
            />
            <Label htmlFor="fr-active" className="cursor-pointer">
              有効
            </Label>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            キャンセル
          </Button>
          <Button
            onClick={onSave}
            disabled={pending || !form.name.trim() || !form.trigger_flag.trim()}
          >
            {pending ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
