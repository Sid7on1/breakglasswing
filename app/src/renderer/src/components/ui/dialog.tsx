import React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../../lib/cn';

/**
 * shadcn-pattern Dialog on Radix primitives — real focus trap, aria-modal, focus restore.
 * `locked` disables Esc/overlay dismissal: the engine's prompt round-trips (governor veto, diff
 * approval) block the agent loop until answered, so the modal must not silently close.
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { locked?: boolean }
>(({ className, locked, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="anim-fade-in fixed inset-0 z-50 bg-[#0a0807]/60" />
    <DialogPrimitive.Content
      ref={ref}
      onEscapeKeyDown={locked ? (e) => e.preventDefault() : undefined}
      onPointerDownOutside={locked ? (e) => e.preventDefault() : undefined}
      onInteractOutside={locked ? (e) => e.preventDefault() : undefined}
      className={cn(
        'anim-dialog-in fixed top-1/2 left-1/2 z-50 max-h-[80vh] w-[min(680px,calc(100vw-64px))] -translate-x-1/2 -translate-y-1/2',
        'overflow-y-auto rounded-2xl border border-line bg-raise p-5 shadow-[0_24px_64px_rgba(0,0,0,0.5)]',
        'focus:outline-none',
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';
