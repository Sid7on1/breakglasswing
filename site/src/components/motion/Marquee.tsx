import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

// Infinite horizontal marquee. Duplicates its children and translates -50% on a linear loop, so the
// seam is invisible. `reverse` flips direction; `speed` is seconds per loop.
export default function Marquee({
  children,
  speed = 28,
  reverse = false,
  className,
}: {
  children: ReactNode;
  speed?: number;
  reverse?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative overflow-hidden ${className ?? ''}`}>
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-ink-950 to-transparent"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-ink-950 to-transparent"
        aria-hidden
      />
      <motion.div
        className="flex w-max gap-12 whitespace-nowrap"
        animate={{ x: reverse ? ['-50%', '0%'] : ['0%', '-50%'] }}
        transition={{ duration: speed, ease: 'linear', repeat: Infinity }}
      >
        <div className="flex gap-12">{children}</div>
        <div className="flex gap-12" aria-hidden>
          {children}
        </div>
      </motion.div>
    </div>
  );
}
