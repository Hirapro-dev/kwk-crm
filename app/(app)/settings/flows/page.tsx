/**
 * /settings/flows — フロー自動化ルール管理
 *
 * 対応歴の「状態」フラグに応じて会員のプロテクトを自動設定するルールを管理する。
 * Salesforce Flow 相当の機能。
 */

import { GitBranch } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PanelHeader } from '@/components/layout/PanelHeader';
import { listFlowRules } from '@/lib/domain/flow_rules';
import { FlowRuleList } from './FlowRuleList';

export default async function SettingsFlowsPage() {
  const rules = await listFlowRules();

  return (
    <div className="space-y-3">
      {/* 説明カード */}
      <Card className="p-4 text-sm text-muted-foreground space-y-1.5">
        <div className="flex items-center gap-2 font-semibold text-foreground">
          <GitBranch className="h-4 w-4 text-primary" />
          フロー自動化について
        </div>
        <p>
          対応歴の入力時、「状態」チェックボックスの値とトリガーが一致したルールが自動実行されます。
        </p>
        <ul className="list-disc pl-4 space-y-0.5">
          <li>
            <strong>N日後のHH:MM</strong> — 登録日から N日後の指定時刻(JST)にプロテクトを解除します。Vercel Cron が毎日処理します。
          </li>
          <li>
            <strong>N時間後</strong> — 登録から N時間後に自動解除します。
          </li>
        </ul>
        <p className="text-xs">
          複数のルールがマッチした場合は「並び順」が小さいルールが優先されます。
        </p>
      </Card>

      {/* ルール一覧 */}
      <Card className="overflow-hidden p-0 shadow-sm">
        <PanelHeader
          iconLabel="FLW"
          iconColor="#8b5cf6"
          viewName="フロー一覧"
          totalCount={rules.length}
        />
        <div className="p-4 space-y-3">
          <FlowRuleList rules={rules} />
        </div>
      </Card>
    </div>
  );
}
