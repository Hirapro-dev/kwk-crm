/**
 * 設定ホーム (/settings)
 *
 * 管理者向けのランディング。
 * 各設定エリアへのリンクカードを並べる。今後 /settings/* が増えたら追加する。
 */

import { Boxes, Briefcase, ChevronRight, GitBranch, Users } from 'lucide-react';
import Link from 'next/link';
import { PanelHeader } from '@/components/layout/PanelHeader';
import { Card } from '@/components/ui/card';

interface QuickLink {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const QUICK_LINKS: QuickLink[] = [
  {
    href: '/settings/users',
    title: 'ユーザー管理',
    description: 'スタッフの権限管理・新規招待・アカウント無効化',
    icon: <Users className="h-5 w-5" />,
  },
  {
    href: '/settings/projects',
    title: '案件マスタ',
    description: '取り扱い案件の追加・編集・有効/無効切替',
    icon: <Briefcase className="h-5 w-5" />,
  },
  {
    href: '/settings/objects',
    title: 'オブジェクト管理',
    description: '各オブジェクトのフィールド表示制御・カスタム項目追加',
    icon: <Boxes className="h-5 w-5" />,
  },
  {
    href: '/settings/flows',
    title: 'フロー',
    description: '対応歴の状態フラグに連動した自動プロテクトルールの設定',
    icon: <GitBranch className="h-5 w-5" />,
  },
];

export default function SettingsHomePage() {
  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="SET"
          iconColor="#04844b"
          viewName="設定ホーム"
        />
        <div className="px-4 py-3 text-sm text-muted-foreground">
          管理者向け設定メニュー。左のサイドメニュー、または下のクイックリンクから各設定エリアへ移動してください。
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {QUICK_LINKS.map((link) => (
          <Link key={link.href} href={link.href}>
            <Card className="flex h-full items-center gap-3 p-4 transition-colors hover:bg-accent">
              <div className="grid h-10 w-10 place-items-center rounded bg-primary/10 text-primary">
                {link.icon}
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-bold">{link.title}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{link.description}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
