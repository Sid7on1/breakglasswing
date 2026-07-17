import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

// Scroll-reveal wrapper: a subtle blur/opacity/y rise as the element enters view, once.
export default function Reveal({
  children,
  delay = 0,
  y = 24,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const staticMode = typeof document !== 'undefined' && document.documentElement.classList.contains('qa-static');

  return (
    <motion.div
      initial={reduce || staticMode ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
