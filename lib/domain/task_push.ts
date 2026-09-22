/**
 * タスク管理のプッシュ通知用 Service Worker の登録先(CLAUDE.md §5.20 migration 116)。
 *
 * 範囲(scope)はマニフェスト `/manifest-task.json` の scope と同じ `/task` にする。
 * iPhone の「ホーム画面に追加」した Web アプリは、マニフェストの範囲と Service Worker の範囲が
 * 食い違うと通知が表示されないことがあるため、両方を必ず同じ値に保つ(2026-09-22)。
 */
export const TASK_SW_URL = '/sw.js';
export const TASK_SW_SCOPE = '/task';
