'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { UserAvatar } from '@/components/users/UserAvatar';
import { AVATAR_SIZE_PX, AVATAR_TYPES } from '@/lib/domain/user_avatar';
import { removeUserAvatar, uploadUserAvatar } from '@/lib/domain/user_avatar_actions';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

/**
 * プロフィール画像の設定ダイアログ(migration 114)。画像を選ぶと画面側で正方形に切り抜いて 256px に縮小し、
 * JPEG にしてアップロードする(元の大きな写真をそのまま送らない)。「画像を外す」で頭文字の表示に戻す。
 */
async function resizeToSquare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = Math.floor((bitmap.width - side) / 2);
  const sy = Math.floor((bitmap.height - side) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE_PX;
  canvas.height = AVATAR_SIZE_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像を処理できません');
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('画像を変換できません'))),
      'image/jpeg',
      0.88,
    );
  });
}

export function AvatarDialog({
  open,
  onOpenChange,
  name,
  email,
  avatarPath,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string | null;
  email: string;
  avatarPath: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (f: File | undefined) => {
    setError(null);
    setBlob(null);
    setPreview(null);
    if (!f) return;
    if (!AVATAR_TYPES[f.type]) {
      setError('JPEG / PNG / WebP の画像を選んでください');
      return;
    }
    try {
      const b = await resizeToSquare(f);
      setBlob(b);
      setPreview(URL.createObjectURL(b));
    } catch (e) {
      setError(e instanceof Error ? e.message : '画像を処理できません');
    }
  };

  const submit = () => {
    if (!blob) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('file', new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
      const r = await uploadUserAvatar(fd);
      if (r.error) {
        setError(r.error);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-w-[92%] sm:max-w-[420px]" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>プロフィール画像</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 p-1 text-sm">
          <div className="flex items-center gap-4">
            {preview ? (
              <img
                src={preview}
                alt="プレビュー"
                width={72}
                height={72}
                className="h-[72px] w-[72px] rounded-full object-cover"
              />
            ) : (
              <UserAvatar name={name} email={email} avatarPath={avatarPath} size={72} />
            )}
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>{name ?? email}</p>
              <p>正方形に切り抜いて {AVATAR_SIZE_PX}px に縮小して保存します。</p>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => pick(e.target.files?.[0])}
            className="block w-full text-xs"
            aria-label="画像を選ぶ"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter className="sm:justify-between">
          {avatarPath ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await removeUserAvatar();
                  if (r.error) {
                    setError(r.error);
                    return;
                  }
                  onOpenChange(false);
                  router.refresh();
                })
              }
            >
              画像を外す
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={submit} disabled={pending || !blob}>
              {pending ? '保存中…' : '保存'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
