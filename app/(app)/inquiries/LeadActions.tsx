'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { InquiryListItem } from '@/lib/domain/inquiries';
import { matchedFieldsLabel, memberMatchLabel } from '@/lib/domain/inquiry_lead';
import {
  type MatchCandidate,
  type MemberBrief,
  createMemberFromInquiry,
  getInquiryMatchCandidates,
  linkInquiryToMember,
  markInquiryReviewed,
  searchMembersForInquiry,
} from '@/lib/domain/inquiry_lead_actions';
import { ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

/**
 * 問合せ一覧(メール取込分)の行操作(CLAUDE.md §5.16 段階④)。
 *   ①会員検索: 自動照合の候補(一致した項目つき)と手動検索から会員を選んで紐付ける
 *   ②新規会員登録: 問合せの氏名・メール・電話・住所を引き継いで会員を作る(K- 採番)
 *   ③確認済み: 会員を作らずに確認済みにする(重複申請など)
 */

const TONE_CLASS = {
  ok: 'bg-emerald-100 text-emerald-800',
  warn: 'bg-amber-100 text-amber-800',
  muted: 'bg-muted text-muted-foreground',
} as const;

function MemberRow({
  m,
  extra,
  onPick,
  pending,
}: {
  m: MemberBrief;
  extra?: string;
  onPick: (id: string) => void;
  pending: boolean;
}) {
  return (
    <li className="flex items-center gap-3 border-t py-2 text-xs first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {/* 候補の会員詳細を別タブで開いて確認できるようにする(ダイアログは閉じない) */}
          <a
            href={`/members/${m.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
            title="会員詳細を別タブで開く"
          >
            {m.name ?? '(氏名なし)'} <span className="font-mono text-muted-foreground">{m.id}</span>
            <ExternalLink className="ml-1 inline h-3 w-3 opacity-60" aria-hidden="true" />
          </a>
        </div>
        <div className="truncate text-muted-foreground">
          {[m.phone1, m.email1, m.address].filter(Boolean).join(' / ') || '-'}
        </div>
        {extra && <div className="text-amber-700">{extra}</div>}
      </div>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => onPick(m.id)}>
        この会員に紐付け
      </Button>
    </li>
  );
}

export function LeadActions({ inquiry }: { inquiry: InquiryListItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<'closed' | 'search' | 'create'>('closed');
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<MatchCandidate[] | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<MemberBrief[] | null>(null);
  const [newName, setNewName] = useState(inquiry.name ?? '');

  const label = memberMatchLabel(inquiry.member_match ?? null, inquiry.member_id);
  const linked = !!inquiry.member_id;

  // 会員検索を開いたら自動照合の候補を取り直す(一致した項目も出す)
  useEffect(() => {
    if (dialog !== 'search') return;
    setCandidates(null);
    setResults(null);
    setError(null);
    getInquiryMatchCandidates(inquiry.id).then((r) => {
      if (r.error) setError(r.error);
      setCandidates(r.candidates ?? []);
    });
  }, [dialog, inquiry.id]);

  const finish = (r: { error?: string }) => {
    if (r.error) {
      setError(r.error);
      return;
    }
    setDialog('closed');
    router.refresh();
  };

  const link = (memberId: string) => {
    setError(null);
    startTransition(async () => finish(await linkInquiryToMember(inquiry.id, memberId)));
  };
  const create = () => {
    setError(null);
    startTransition(async () => finish(await createMemberFromInquiry(inquiry.id, newName)));
  };
  const review = () => {
    setError(null);
    startTransition(async () => finish(await markInquiryReviewed(inquiry.id)));
  };
  const search = () => {
    setError(null);
    startTransition(async () => {
      const r = await searchMembersForInquiry(q);
      if (r.error) setError(r.error);
      setResults(r.members ?? []);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`rounded px-1.5 py-0.5 text-[11px] ${TONE_CLASS[label.tone]}`}>
        {label.text}
      </span>
      {!linked && (
        <>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => setDialog('search')}
          >
            会員検索
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => setDialog('create')}
          >
            新規会員登録
          </Button>
          {inquiry.member_match?.status !== 'manual' && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              disabled={pending}
              onClick={review}
              title="会員を作らずに確認済みにします"
            >
              確認済み
            </Button>
          )}
        </>
      )}

      <Dialog open={dialog === 'search'} onOpenChange={(o) => !o && setDialog('closed')}>
        <DialogContent className="max-w-[90%] sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>会員検索: {inquiry.name ?? inquiry.id}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1 text-sm">
            <section className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">
                自動照合の候補(氏名・電話・メール・住所の一致で判定)
              </p>
              {candidates === null ? (
                <p className="text-xs text-muted-foreground">照合中…</p>
              ) : candidates.length === 0 ? (
                <p className="text-xs text-muted-foreground">一致する会員はありません。</p>
              ) : (
                <ul>
                  {candidates.map((c) => (
                    <MemberRow
                      key={c.id}
                      m={c}
                      extra={`一致 ${c.points} 点: ${matchedFieldsLabel(c.matched)}`}
                      onPick={link}
                      pending={pending}
                    />
                  ))}
                </ul>
              )}
            </section>
            <section className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">
                手動で検索(電話番号・メールアドレスでの目視確認)
              </p>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  search();
                }}
              >
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="氏名・カナ・メール・電話・会員ID"
                />
                <Button type="submit" variant="outline" disabled={pending || !q.trim()}>
                  検索
                </Button>
              </form>
              {results && (
                <ul>
                  {results.length === 0 ? (
                    <li className="text-xs text-muted-foreground">該当する会員はありません。</li>
                  ) : (
                    results.map((m) => (
                      <MemberRow key={m.id} m={m} onPick={link} pending={pending} />
                    ))
                  )}
                </ul>
              )}
            </section>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog('closed')} disabled={pending}>
              閉じる
            </Button>
            <Button variant="outline" onClick={() => setDialog('create')} disabled={pending}>
              会員がいないので新規登録へ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'create'} onOpenChange={(o) => !o && setDialog('closed')}>
        <DialogContent className="max-w-[90%] sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>新規会員登録</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="space-y-1">
              <Label>会員の氏名</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                問合せのメール・電話・住所を引き継ぎます。会員IDは K- 形式で自動採番されます。
              </p>
            </div>
            <dl className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <dt>メール</dt>
              <dd>{inquiry.email ?? '-'}</dd>
              <dt>電話</dt>
              <dd>{inquiry.phone ?? '-'}</dd>
            </dl>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog('closed')} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={create} disabled={pending || !newName.trim()}>
              {pending ? '登録中…' : '会員を登録して紐付け'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
