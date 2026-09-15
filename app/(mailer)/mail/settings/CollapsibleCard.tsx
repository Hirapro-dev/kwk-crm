'use client';

import { PanelHeader } from '@/components/layout/PanelHeader';
import { Card } from '@/components/ui/card';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * /mail/settings の各セクションをアコーディオン(開閉式)にするカード(CLAUDE.md §8.1)。
 * 見出し(PanelHeader)全体をクリックで開閉。既定は閉じた状態で、開閉状態は端末ごとに
 * ブラウザへ記憶する(設定の並びは固定なのでサーバーに持つ必要はない)。
 * キーボード操作は見出し右端の矢印ボタン(実体は button)で行う。
 * 見出し右側の操作ボタン(actions)はクリックしても開閉しない。
 */
interface Props {
  /** 開閉状態の記憶キー(セクションごとに一意) */
  id: string;
  iconLabel: string;
  iconColor?: string;
  viewName: string;
  totalCount?: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

const STORAGE_PREFIX = 'mail-settings-open:';

export function CollapsibleCard({
  id,
  iconLabel,
  iconColor,
  viewName,
  totalCount,
  actions,
  children,
}: Props) {
  const [open, setOpen] = useState(false);

  // 初期表示はサーバーと同じ「閉じる」で描画し、マウント後に記憶を反映する(表示のずれを防ぐ)
  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_PREFIX + id) === '1') setOpen(true);
    } catch {
      /* ブラウザの保存領域が使えないときは既定(閉じる)のまま */
    }
  }, [id]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(STORAGE_PREFIX + id, next ? '1' : '0');
    } catch {
      /* 記憶できなくても開閉自体は動く */
    }
  };

  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <Card className="overflow-hidden p-0 shadow-sm">
      {/* 見出し全体をクリック対象にする。キーボード操作は右端の矢印ボタンが担う(見出しの中に
          既に操作ボタンが入るため、見出し自体を button にはできない) */}
      <div onClick={toggle} className="cursor-pointer select-none hover:bg-accent/40">
        <PanelHeader
          iconLabel={iconLabel}
          iconColor={iconColor}
          viewName={viewName}
          totalCount={totalCount}
          actions={
            <span className="flex items-center gap-2">
              {actions && <span onClick={(e) => e.stopPropagation()}>{actions}</span>}
              <button
                type="button"
                aria-expanded={open}
                aria-controls={`mail-settings-section-${id}`}
                aria-label={open ? `${viewName} を閉じる` : `${viewName} を開く`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle();
                }}
                className="rounded p-1 text-muted-foreground hover:bg-accent"
              >
                <Chevron className="h-4 w-4" aria-hidden="true" />
              </button>
            </span>
          }
        />
      </div>
      {open && <div id={`mail-settings-section-${id}`}>{children}</div>}
    </Card>
  );
}
