/**
 * 会員詳細画面(仕様書 §8.1)
 *
 * 本体は再利用可能な MemberDetailPanel に切り出し済み。
 * (フルページ詳細と、会員一覧の分割ビュー右ペインで共用する)
 * このページは URL パラメータ解決 + パンくずの戻り先決定のみを担当する。
 */

import { MemberDetailPanel } from '../MemberDetailPanel';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}

export default async function MemberDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { from } = await searchParams;
  // 遷移元(from)が内部パスのときだけ戻り先に使う(オープンリダイレクト防止に "//" は除外)。
  // レポートから来た場合はレポート結果画面へ戻す。それ以外/未指定は従来どおり会員一覧へ。
  const isInternalFrom = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//');
  const backTo = isInternalFrom ? from : '/members';
  const backLabel = backTo.startsWith('/reports') ? 'レポートへ戻る' : '会員一覧へ';

  return <MemberDetailPanel memberId={id} backTo={backTo} backLabel={backLabel} />;
}
