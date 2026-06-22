import * as React from 'react';
import { cn } from '@/lib/utils/cn';

type Variant = 'default' | 'secondary' | 'outline' | 'destructive' | 'success';

// SLDS Lightning バッジ: 角丸は小さめで控えめなコントラスト
const VARIANT: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground',
  secondary: 'bg-secondary text-secondary-foreground border border-border',
  outline: 'border border-input text-foreground bg-card',
  destructive: 'bg-destructive/10 text-destructive border border-destructive/30',
  success: 'bg-green-100 text-green-800 border border-green-300',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

export function Badge({ className, variant = 'secondary', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-medium leading-none',
        VARIANT[variant],
        className,
      )}
      {...props}
    />
  );
}
