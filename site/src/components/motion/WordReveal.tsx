import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

// Headline reveal: each word blurs + rises in, staggered. Pass an array of words; mark accent words
// with { italic: true } to render them in italic (our serif accent treatment).
export interface Word {
  text: string;
  italic?: boolean;
  br?: boolean; // force a line break after this word
}

export default function WordReveal({
  words,
  className,
  delay = 0,
  stagger = 0.06,
}: {
  words: Word[];
  className?: string;
  delay?: number;
  stagger?: number;
}) {
  return (
    <span className={className} style={{ display: 'inline' }}>
      {words.map((w, i) => (
        <span key={i} style={{ display: w.br ? 'block' : 'inline' }}>
          <motion.span
            initial={{ opacity: 0, y: '0.4em', filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: delay + i * stagger }}
            style={{ display: 'inline-block', fontStyle: w.italic ? 'italic' : undefined, marginRight: '0.22em' }}
          >
            {w.text as ReactNode}
          </motion.span>
        </span>
      ))}
    </span>
  );
}
