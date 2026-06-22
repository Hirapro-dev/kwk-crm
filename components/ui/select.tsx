import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * シンプルなネイティブ <select> ラッパ。
 * Combobox 化は Phase 6 で必要なら検討(キーボード絞り込みは標準で効く)。
 */
export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-8 w-full rounded border border-input bg-card px-2 py-1 text-sm',
        'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';
