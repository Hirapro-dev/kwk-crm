import * as React from 'react';
import { cn } from '@/lib/utils/cn';

type Variant = 'default' | 'outline' | 'ghost' | 'destructive' | 'secondary';
type Size = 'sm' | 'default' | 'lg' | 'icon';

// SLDS: brand / neutral / destructive / text-link 風の見た目
const VARIANT_CLASS: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90 border border-primary',
  outline:
    'border border-input bg-card text-foreground hover:bg-accent hover:text-accent-foreground',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  destructive:
    'bg-destructive text-destructive-foreground hover:bg-destructive/90 border border-destructive',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-input',
};

// SLDS は高さが低めで角丸が小さい(--radius=0.25rem)
const SIZE_CLASS: Record<Size, string> = {
  sm: 'h-7 px-3 text-xs',
  default: 'h-8 px-3 text-xs',
  lg: 'h-10 px-4 text-sm',
  icon: 'h-8 w-8',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 rounded font-medium',
          'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:pointer-events-none disabled:opacity-50',
          VARIANT_CLASS[variant],
          SIZE_CLASS[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
