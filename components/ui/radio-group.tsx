/**
 * シンプルラジオグループ (Radix UIなし)
 */
'use client';

import * as React from 'react';
import { cn } from '@/lib/utils/cn';

interface RadioGroupProps {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}

const RadioGroupContext = React.createContext<{
  value: string;
  onValueChange: (v: string) => void;
}>({ value: '', onValueChange: () => {} });

export function RadioGroup({ value, onValueChange, className, children }: RadioGroupProps) {
  return (
    <RadioGroupContext.Provider value={{ value, onValueChange }}>
      <div role="radiogroup" className={cn('space-y-2', className)}>
        {children}
      </div>
    </RadioGroupContext.Provider>
  );
}

interface RadioGroupItemProps {
  value: string;
  id?: string;
  className?: string;
}

export function RadioGroupItem({ value, id, className }: RadioGroupItemProps) {
  const ctx = React.useContext(RadioGroupContext);
  const checked = ctx.value === value;

  return (
    <input
      type="radio"
      id={id}
      value={value}
      checked={checked}
      onChange={() => ctx.onValueChange(value)}
      className={cn(
        'h-4 w-4 cursor-pointer accent-primary',
        className,
      )}
    />
  );
}
