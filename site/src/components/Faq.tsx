import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { FAQ } from '../lib/content';

function Item({ q, a, open, onToggle }: { q: string; a: string; open: boolean; onToggle: () => void }) {
  const reduce = useReducedMotion();

  return (
    <div className="border-b border-line">
      <h3>
        <button onClick={onToggle} aria-expanded={open} className="faq-button">
          <span>{q}</span>
          <span className={open ? 'rotate-45' : ''} aria-hidden>+</span>
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <p className="max-w-[46rem] pb-7 pr-12 leading-7 text-mist">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="border-t border-line">
      {FAQ.map((item, index) => (
        <Item
          key={item.q}
          q={item.q}
          a={item.a}
          open={open === index}
          onToggle={() => setOpen(open === index ? null : index)}
        />
      ))}
    </div>
  );
}
