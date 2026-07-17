import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/** Shared button variants on the active Bimax appearance tokens. */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors ' +
    'cursor-pointer select-none whitespace-nowrap disabled:pointer-events-none disabled:opacity-45 ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember/60',
  {
    variants: {
      variant: {
        default:
          'border border-line bg-raise text-ink hover:border-ember hover:bg-ember/15',
        accent: 'bg-ember font-semibold text-white hover:bg-ember-bright',
        ghost: 'text-dim hover:bg-hover hover:text-ink',
        destructive: 'bg-rust text-white hover:opacity-90',
        outline:
          'border border-line bg-transparent text-ink hover:border-ember hover:bg-ember/15',
      },
      size: {
        default: 'px-3.5 py-2 text-[13px]',
        sm: 'px-3 py-1.5 text-xs',
        lg: 'px-5 py-2.5 text-sm',
        icon: 'size-[30px] shrink-0 rounded-lg text-[15px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';

export { buttonVariants };
