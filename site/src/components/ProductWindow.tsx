import { motion, useReducedMotion } from 'framer-motion';

// A real product screenshot in app-window chrome, lit like a product shot.
// Screenshots carry the actual UI; copy never repeats their internal labels.
export default function ProductWindow({
  src,
  alt,
  label,
  className = '',
  priority = false,
}: {
  src: string;
  alt: string;
  label?: string;
  className?: string;
  priority?: boolean;
}) {
  const reduce = useReducedMotion();
  const staticMode = typeof document !== 'undefined' && document.documentElement.classList.contains('qa-static');

  return (
    <motion.figure
      initial={reduce || staticMode ? false : { opacity: 0, y: 28, scale: 0.985 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
      className={`window-chrome liquid-glass liquid-glass-window ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-white/[0.07] bg-[#10110f] px-4 py-2.5">
        {label && (
          <span className="utility-label truncate text-white/45">{label}</span>
        )}
      </div>
      <img
        src={src}
        alt={alt}
        width="1800"
        height="1075"
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        className="block h-auto w-full"
      />
    </motion.figure>
  );
}
