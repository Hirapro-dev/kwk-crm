'use client';

import { AdMasterPicker } from '@/components/masters/AdMasterPicker';
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
import { type CreateMemberResult, createMember } from '@/lib/domain/member_actions';
import { GENDER_OPTIONS } from '@/lib/domain/member_gender';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * 会員一覧の「新規登録」ダイアログ(CLAUDE.md §8.1)。問合せを経由せずに会員を作る。
 * 氏名は必須。広告は【取得】で広告マスタから選ぶと広告ID・広告媒体名の両方に入る。
 * 同じメール/電話の会員があれば一度止めて候補を出し、承知のうえで登録できる。
 * 登録後は作成した会員の詳細へ移動する。
 */
interface Props {
  users: Array<{ id: string; name: string }>;
  currentUserId: string;
  acquisitionPoints: string[];
}

function todayJst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function NewMemberDialog({ users, currentUserId, acquisitionPoints }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<CreateMemberResult['duplicates']>(undefined);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [adPickerOpen, setAdPickerOpen] = useState(false);

  const [name, setName] = useState('');
  const [nameKana, setNameKana] = useState('');
  const [gender, setGender] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [address, setAddress] = useState('');
  const [adId, setAdId] = useState('');
  const [adMedium, setAdMedium] = useState('');
  const [pointName, setPointName] = useState('');
  const [acquiredDate, setAcquiredDate] = useState(todayJst);
  const [mailmagAt, setMailmagAt] = useState('');
  const [ownerId, setOwnerId] = useState(currentUserId);

  const reset = () => {
    setError(null);
    setDuplicates(undefined);
    setAllowDuplicate(false);
    setName('');
    setNameKana('');
    setGender('');
    setEmail('');
    setPhone('');
    setPostalCode('');
    setAddress('');
    setAdId('');
    setAdMedium('');
    setPointName('');
    setAcquiredDate(todayJst());
    setMailmagAt('');
    setOwnerId(currentUserId);
  };

  const submit = () => {
    setError(null);
    setDuplicates(undefined);
    startTransition(async () => {
      const r = await createMember({
        name,
        name_kana: nameKana,
        gender,
        email1: email,
        phone1: phone,
        postal_code: postalCode,
        address,
        ad_id: adId,
        ad_medium: adMedium,
        info_acquired_points: pointName,
        info_acquired_date: acquiredDate,
        mailmag_registered_at: mailmagAt,
        owner_id: ownerId || null,
        allowDuplicate,
      });
      if (!r.ok || !r.id) {
        setError(r.error ?? '登録に失敗しました');
        setDuplicates(r.duplicates);
        return;
      }
      setOpen(false);
      reset();
      router.push(`/members/${r.id}`);
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
        <DialogContent className="max-w-[92%] sm:max-w-[720px]" onClose={() => setOpen(false)}>
          <DialogHeader>
            <DialogTitle>会員の新規登録</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] space-y-4 overflow-y-auto p-1 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">氏名(必須)</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">氏名(カナ)</Label>
                <Input value={nameKana} onChange={(e) => setNameKana(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">性別</Label>
                <Select value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option value="">(未設定)</option>
                  {GENDER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">メール</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">電話</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">郵便番号</Label>
                <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">住所</Label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">広告ID</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={adId}
                    onChange={(e) => setAdId(e.target.value)}
                    placeholder="例: N0000003"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 whitespace-nowrap"
                    onClick={() => setAdPickerOpen(true)}
                    title="広告マスタから選んで、広告ID と広告媒体名の両方に入れます"
                  >
                    取得
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">広告媒体名</Label>
                <div className="flex items-center gap-2">
                  <Input value={adMedium} onChange={(e) => setAdMedium(e.target.value)} />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 whitespace-nowrap"
                    onClick={() => setAdPickerOpen(true)}
                  >
                    取得
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">個人情報取得ポイント</Label>
                <Select value={pointName} onChange={(e) => setPointName(e.target.value)}>
                  <option value="">(未設定)</option>
                  {acquisitionPoints.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">顧客情報取得日</Label>
                <Input
                  type="date"
                  value={acquiredDate}
                  onChange={(e) => setAcquiredDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">メルマガ登録日時</Label>
                <Input
                  type="datetime-local"
                  value={mailmagAt}
                  onChange={(e) => setMailmagAt(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">担当</Label>
                <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                  <option value="">未設定</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {duplicates && duplicates.length > 0 && (
              <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs">
                <p className="font-semibold text-amber-800">
                  同じメールまたは電話番号の会員が既にあります。重複登録でないか確認してください。
                </p>
                <ul className="space-y-1">
                  {duplicates.map((d) => (
                    <li key={d.id}>
                      <a
                        href={`/members/${d.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {d.name ?? '(氏名なし)'} <span className="font-mono">{d.id}</span>
                      </a>
                      <span className="ml-2 text-muted-foreground">
                        {[d.phone1, d.email1].filter(Boolean).join(' / ')}
                      </span>
                    </li>
                  ))}
                </ul>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={allowDuplicate}
                    onChange={(e) => setAllowDuplicate(e.target.checked)}
                  />
                  別人であることを確認したので、このまま登録する
                </label>
              </div>
            )}
            {error && !(duplicates && duplicates.length > 0) && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button
              onClick={submit}
              disabled={pending || !name.trim() || (!!duplicates?.length && !allowDuplicate)}
            >
              {pending ? '登録中…' : '登録'}
            </Button>
          </DialogFooter>
          <AdMasterPicker
            open={adPickerOpen}
            onOpenChange={setAdPickerOpen}
            onPick={(ad) => {
              setAdId(ad.id);
              setAdMedium(ad.name);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
