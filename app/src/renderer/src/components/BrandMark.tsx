import React from 'react';
import { cn } from '../lib/cn';

/** The product identity is deliberately type-only: no symbol, badge, monogram, or avatar. */
export function BrandMark({ className = '' }: { className?: string }): React.ReactElement {
  return (
    <span className={cn('bimax-wordmark inline-flex shrink-0 items-center', className)} aria-label="BiMAX">BiMAX</span>
  );
}
