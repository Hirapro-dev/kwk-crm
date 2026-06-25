'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * アコーディオングループをまとめて展開/折りたたむトグルボタン。
 * `expand-all-fieldgroups` / `collapse-all-fieldgroups` カスタムイベントを発火する。
 * CollapsibleFieldGroup がそれぞれ応答して状態を切り替える。
 */
export function ExpandAllButton() {
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    window.dispatchEvent(
      new CustomEvent(next ? 'expand-all-fieldgroups' : 'collapse-all-fieldgroups'),
    );
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
    >
      {expanded ? (
        <>
          <ChevronUp className="h-3.5 w-3.5" />
          すべて折りたたむ
        </>
      ) : (
        <>
          <ChevronDown className="h-3.5 w-3.5" />
          すべて展開
        </>
      )}
    </Button>
  );
}
