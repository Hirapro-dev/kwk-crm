'use client';

/**
 * 新規レポート ステップ1: オブジェクト選択(主軸 + 任意の結合)。
 *
 * 主軸を選ぶと結合可能なオブジェクトが絞り込まれる。
 * 「次へ」で組み合わせを既存レポートタイプに解決し、同じ画面の
 * ビルダー(/reports/new?type=RTxx)へ遷移する。
 */

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { BASE_OBJECTS, resolveReportType } from '@/lib/reports/object_pairs';

export function ObjectSelector() {
  const router = useRouter();
  const [baseKey, setBaseKey] = useState('');
  const [relatedKey, setRelatedKey] = useState('');

  const base = useMemo(
    () => BASE_OBJECTS.find((b) => b.key === baseKey),
    [baseKey],
  );
  const resolved = resolveReportType(baseKey, relatedKey || undefined);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* 主軸オブジェクト(必須) */}
        <div className="space-y-1.5">
          <Label htmlFor="base-object">
            主軸オブジェクト <span className="text-destructive">*</span>
          </Label>
          <Select
            id="base-object"
            value={baseKey}
            onChange={(e) => {
              setBaseKey(e.target.value);
              setRelatedKey('');
            }}
          >
            <option value="">選択してください</option>
            {BASE_OBJECTS.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            レポートの 1 行の単位になるオブジェクトです。
          </p>
        </div>

        {/* 結合オブジェクト(任意) */}
        <div className="space-y-1.5">
          <Label htmlFor="related-object">結合オブジェクト(任意)</Label>
          <Select
            id="related-object"
            value={relatedKey}
            onChange={(e) => setRelatedKey(e.target.value)}
            disabled={!base}
          >
            <option value="">（結合なし）</option>
            {base?.relations.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            {base
              ? '主軸に紐付けて表示するオブジェクトを選べます。'
              : 'まず主軸オブジェクトを選択してください。'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          disabled={!resolved}
          onClick={() => {
            if (resolved) router.push(`/reports/new?type=${resolved}`);
          }}
        >
          次へ（カラム・フィルタ設定）
        </Button>
        {base && (
          <span className="text-xs text-muted-foreground">
            {base.label}
            {relatedKey
              ? ` × ${base.relations.find((r) => r.key === relatedKey)?.label}`
              : '（単体）'}
          </span>
        )}
      </div>
    </div>
  );
}
