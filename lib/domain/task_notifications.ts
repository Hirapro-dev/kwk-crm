/**
 * タスク通知(プッシュ / メール)の文面を決める純粋関数。CLAUDE.md §5.20(migration 116)。
 * 送信の実体は lib/notify/task_notify.ts。
 */

export type TaskNotificationKind = 'assigned' | 'mentioned';

export interface TaskNotificationPayload {
  title: string;
  body: string;
  /** 開く先(サイト内パス) */
  url: string;
  /** 同じタスクの通知をまとめるためのタグ */
  tag: string;
}

/** 通知の文面。プッシュは短く、メールは件名 = title、本文 = body + URL */
export function buildTaskNotification(
  kind: TaskNotificationKind,
  input: {
    taskId: number;
    taskName: string;
    actorName: string | null;
    projectName?: string | null;
  },
): TaskNotificationPayload {
  const who = input.actorName?.trim() || '誰か';
  const task = input.taskName.trim() || '(名称未設定)';
  const project = input.projectName?.trim() ? `(${input.projectName.trim()})` : '';
  const url = `/task/${input.taskId}`;
  if (kind === 'assigned') {
    return {
      title: `${who} さんがあなたにタスクを割り当てました`,
      body: `${task}${project}`,
      url,
      tag: `task-${input.taskId}-assigned`,
    };
  }
  return {
    title: `${who} さんがコメントであなたを呼びました`,
    body: `${task}${project}`,
    url,
    tag: `task-${input.taskId}-mention`,
  };
}

/** 通知メールの本文(テキスト)。URL は絶対 URL にする */
export function buildNotificationEmailText(p: TaskNotificationPayload, siteUrl: string): string {
  const base = siteUrl.replace(/\/+$/, '');
  return [
    p.title,
    '',
    p.body,
    '',
    `開く: ${base}${p.url}`,
    '',
    '--',
    'ひらプロタスク(通知の ON/OFF はタスク管理の歯車メニュー「通知の設定」から)',
  ].join('\n');
}
