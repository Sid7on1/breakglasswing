import React from 'react';
import { cn } from '../lib/cn';

/** Two distinct signals resolving into one shared center — the Bimax product idea in one mark. */
export function BrandMark({ className = '' }: { className?: string }): React.ReactElement {
  return (
    <span className={cn('bimax-mark inline-flex shrink-0 items-center justify-center', className)} aria-hidden>
      <span className="bimax-mark-orbit bimax-mark-orbit-a" />
      <span className="bimax-mark-orbit bimax-mark-orbit-b" />
      <span className="bimax-mark-core" />
    </span>
  );
}
