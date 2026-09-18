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
import { Select } from '@/components/ui/select';
import { createApplication } from '@/lib/domain/application_actions';
import { APP_STATUSES, FLOW_TYPES } from '@/lib/domain/applications_constants';
import { type MemberBrief, searchMembersForInquiry } from '@/lib/domain/inquiry_lead_actions';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

/**
 * 申込一覧の「新規登録」ダイアログ(CLAUDE.md §5.6 / §8.1)。
 * 会員は検索して選ぶ(必須)。案件・申込日・ステータスは必須、それ以外は任意。
 * 項目は 案件 / 申込日 / ステータス / 区分 / 申込獲得者 / 契約書送付日 / 利息 / 起算日時 / 契約期日 / 契約期間(●ヶ月) / 入金日 / 入金額
 * (2026-09-18: 担当・入金予定日・入金予定額を外し、契約書送付日・利息(interest。既存の円金利 yen_interest とは別)・起算日時・契約期日を追加。担当は登録者を既定にする)。
 * 登録後は作成した申込の詳細へ移動する。
 */
interface Props {
  projects: Array<{ id: number; name: string }>;
  users: Array<{ id: string; name: string }>;
}

function todayJst(): string {
  // 日本時間の今日(YYYY-MM-DD)
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

export function NewApplicationDialog({ projects, users }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 会員検索
  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState<MemberBrief[]>([]);
  const [searching, setSearching] = useState(false);
  const [member, setMember] = useState<MemberBrief | null>(null);

  // 入力
  const [projectId, setProjectId] = useState('');
  const [applicationDate, setApplicationDate] = useState(todayJst);
  const [status, setStatus] = useState<string>('対応中');
  const [flowType, setFlowType] = useState('');
  const [acquirerId, setAcquirerId] = useState('');
  const [contractSentDate, setContractSentDate] = useState('');
  const [interest, setInterest] = useState('');
  const [startDatetime, setStartDatetime] = useState('');
  const [contractEndDate, setContractEndDate] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [contractPeriod, setContractPeriod] = useState('');

  // 検索語の入力が止まってから検索する(サーバーへの問い合わせを減らす)
  useEffect(() => {
    if (!open) return;
    const q = memberQuery.trim();
    if (!q) {
      setMemberResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      const r = await searchMembersForInquiry(q);
      setMemberResults(r.members ?? []);
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [memberQuery, open]);

  const reset = () => {
    setError(null);
    setMemberQuery('');
    setMemberResults([]);
    setMember(null);
    setProjectId('');
    setApplicationDate(todayJst());
    setStatus('対応中');
    setFlowType('');
    setAcquirerId('');
    setContractSentDate('');
    setInterest('');
    setStartDatetime('');
    setContractEndDate('');
    setPaymentDate('');
    setPaymentAmount('');
    setContractPeriod('');
  };

  const toAmount = (s: string): number | null => {
    const t = s.replace(/,/g, '').trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : Number.NaN;
  };

  const submit = () => {
    setError(null);
    if (!member) {
      setError('会員を検索して選択してください');
      return;
    }
    if (!projectId) {
      setError('案件を選択してください');
      return;
    }
    const pa = toAmount(paymentAmount);
    if (Number.isNaN(pa)) {
      setError('金額は数字で入力してください');
      return;
    }
    const it = toAmount(interest);
    if (Number.isNaN(it)) {
      setError('利息は数字で入力してください');
      return;
    }
    startTransition(async () => {
      const r = await createApplication({
        memberId: member.id,
        projectId: Number(projectId),
        applicationDate,
        status,
        flowType: flowType || null,
        acquirerId: acquirerId || null,
        contractSentDate: contractSentDate || null,
        interest: it,
        startDatetime: startDatetime || null,
        contractEndDate: contractEndDate || null,
        paymentDate: paymentDate || null,
        paymentAmount: pa,
        contractPeriod: contractPeriod || null,
      });
      if (!r.ok || !r.id) {
        setError(r.error ?? '登録に失敗しました');
        return;
      }
      setOpen(false);
      reset();
      router.push(`/applications/${r.id}`);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        新規登録
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && !pending && setOpen(false)}>
        <DialogContent className="max-w-[92%] sm:max-w-[680px]" onClose={() => setOpen(false)}>
          <DialogHeader>
            <DialogTitle>申込の新規登録</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto p-1 text-sm">
            {/* 会員 */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">会員(必須)</Label>
              {member ? (
                <div className="flex items-center justify-between rounded border bg-muted/30 px-3 py-2">
                  <span>
                    <span className="font-medium">{member.name ?? '(氏名なし)'}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {member.id}
                      {member.phone1 ? ` / ${member.phone1}` : ''}
                      {member.email1 ? ` / ${member.email1}` : ''}
                    </span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setMember(null)}>
                    変更
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    placeholder="氏名・カナ・メール・電話・会員IDで検索"
                    autoFocus
                  />
                  {searching && <p className="text-xs text-muted-foreground">検索中…</p>}
                  {!searching && memberQuery.trim() && memberResults.length === 0 && (
                    <p className="text-xs text-muted-foreground">該当する会員がありません</p>
                  )}
                  {memberResults.length > 0 && (
                    <ul className="max-h-48 overflow-y-auto rounded border text-xs">
                      {memberResults.map((m) => (
                        <li key={m.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setMember(m);
                              setMemberQuery('');
                            }}
                            className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-accent"
                          >
                            <span className="font-medium">{m.name ?? '(氏名なし)'}</span>
                            <span className="text-muted-foreground">
                              {m.id}
                              {m.phone1 ? ` / ${m.phone1}` : ''}
                              {m.email1 ? ` / ${m.email1}` : ''}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">案件(必須)</Label>
                <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  <option value="">選択</option>
                  {projects.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">申込日(必須)</Label>
                <Input
                  type="date"
                  value={applicationDate}
                  onChange={(e) => setApplicationDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">ステータス</Label>
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  {APP_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">区分</Label>
                <Select value={flowType} onChange={(e) => setFlowType(e.target.value)}>
                  <option value="">未設定</option>
                  {FLOW_TYPES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">申込獲得者</Label>
                <Select value={acquirerId} onChange={(e) => setAcquirerId(e.target.value)}>
                  <option value="">未設定</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">契約書送付日</Label>
                <Input
                  type="date"
                  value={contractSentDate}
                  onChange={(e) => setContractSentDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">利息(円)</Label>
                <Input
                  inputMode="numeric"
                  value={interest}
                  onChange={(e) => setInterest(e.target.value)}
                  placeholder="例: 100000"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">起算日時(契約期間の開始)</Label>
                <Input
                  type="datetime-local"
                  value={startDatetime}
                  onChange={(e) => setStartDatetime(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">契約期日(契約期間の終了)</Label>
                <Input
                  type="date"
                  value={contractEndDate}
                  onChange={(e) => setContractEndDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">契約期間(●ヶ月)</Label>
                <Input
                  value={contractPeriod}
                  onChange={(e) => setContractPeriod(e.target.value)}
                  placeholder="例: 12ヶ月"
                  maxLength={50}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">入金日</Label>
                <Input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">入金額(円)</Label>
                <Input
                  inputMode="numeric"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="例: 1000000"
                />
              </div>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? '登録中…' : '登録'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
