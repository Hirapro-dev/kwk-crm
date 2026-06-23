/**
 * シンプルモーダルダイアログ (Radix UIなし)
 */
'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      {children}
    </div>
  );
}

interface DialogContentProps {
  className?: string;
  children: React.ReactNode;
  onClose?: () => void;
}

export function DialogContent({ className, children, onClose }: DialogContentProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        'relative z-10 w-full max-h-[90vh] overflow-y-auto rounded-lg border bg-background p-6 shadow-xl',
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {onClose && (
        <button
          type="button"
          aria-label="閉じる"
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      {children}
    </div>
  );
}

export function DialogHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('mb-4', className)}>{children}</div>;
}

export function DialogTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return <h2 className={cn('text-lg font-semibold', className)}>{children}</h2>;
}

export function DialogFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('mt-6 flex justify-end gap-2', className)}>{children}</div>;
}
