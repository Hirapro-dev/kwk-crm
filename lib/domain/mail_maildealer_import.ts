/**
 * メールディーラーの CSV エクスポート取込(過去データ取込 / CLAUDE.md §5.15)の決定論的ロジック。
 * `scripts/mail/import_maildealer.ts` から使う純粋関数。DB・ファイルには触れない。
 *
 * 2026-09-11 ユーザー確認済みの決定事項:
 *   1. スレッドの状態は CSV の「メール状態」をそのまま反映する
 *   2. 担当者名は対応表で解決できたものだけ紐付ける(あいまいなものは割り当てない)
 */

import type { MailStatus } from './mail_types';

/**
 * CSV の「メール種別」「メール状態」からスレッド状態を決める。
 *   受信メールで「新着」→ 未対応 / 「対応完了」→ 完了
 *   送信メール(メール状態の列にも "送信メール" と入る)→ 対応中
 *     (ライブの返信時と同じ扱い。lib/domain/mail_send_actions.ts 参照)
 * 想定外の値は null を返し、呼び出し側でスレッドの状態を変えない判断をできるようにする。
 */
export function mapMaildealerThreadStatus(mailKind: string, mailStatus: string): MailStatus | null {
  if (mailKind === '送信メール') return '対応中';
  if (mailStatus === '新着') return '未対応';
  if (mailStatus === '対応完了') return '完了';
  return null;
}

/**
 * 「担当者名」列から突合キーを作る。
 * メールディーラーは退職者の担当者名に "(deleted_id:1234)" を付けて残すため、これを取り除く。
 * 前後の空白を除き小文字化する(users のメールアドレスと突合する側で同じ正規化をする)。
 */
export function maildealerAssigneeToken(raw: string | null | undefined): string {
  return (raw ?? '')
    .replace(/\(deleted_id:\d+\)\s*$/i, '')
    .trim()
    .toLowerCase();
}

/**
 * 本文が HTML かの簡易判定(このエクスポートには text/html の区別が無く、本文が1列しか無いため)。
 * html/body/table 等の代表的なブロックタグを含むかで決める。誤判定してもメーラー側は
 * MailBodyViewer が両方に対応するテキスト表示にフォールバックするため実害は小さい。
 */
export function looksLikeHtmlBody(body: string | null | undefined): boolean {
  return /<\s*(html|body|table|div|p)[\s>]/i.test(body ?? '');
}
