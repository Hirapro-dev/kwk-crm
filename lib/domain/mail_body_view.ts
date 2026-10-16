/**
 * メール本文(HTML)の表示まわりの決まりごと(CLAUDE.md §5.15 セキュリティ)。純粋関数・定数のみ。
 * 表示は app/(mailer)/mail/MailBodyViewer.tsx。
 */

/**
 * 本文を表示する iframe の sandbox。
 * - 許可するのは「リンクを新しいタブで開く」ことだけ(allow-popups)。開いた先は普通のページとして動かす
 *   (allow-popups-to-escape-sandbox。付けないとリンク先のサイトもスクリプト禁止のまま開き、まともに表示されない)
 * - スクリプト・同一オリジン扱い・親画面(メーラー)の書き換え・フォーム送信は許可しない
 * 2026-10-16: 以前は sandbox=""(すべて禁止)で、<base target="_blank"> のリンクをブラウザが黙って止めていた。
 */
export const MAIL_BODY_IFRAME_SANDBOX = 'allow-popups allow-popups-to-escape-sandbox';

/**
 * a タグの target 属性を取り除く。本文側の <base target="_blank"> を効かせ、どのリンクも新しいタブで開くようにする
 * (target="_self" だと小さな本文の枠の中で外部サイトが開き、"_top" はメーラーの画面を置き換えようとする(sandbox で止まる))。
 */
export function stripAnchorTargets(html: string): string {
  return html.replace(/<a\b[^>]*>/gi, (tag) =>
    tag.replace(/\s+target\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ''),
  );
}
