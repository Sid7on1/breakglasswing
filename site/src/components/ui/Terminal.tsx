import type { ReactNode } from 'react';

// A faux macOS-style terminal/code window in the glass design language. `lines` render as monospace
// rows; tokens with a role get the accent/dim colors so it reads like a real session.
export interface Line {
  text: ReactNode;
  prompt?: boolean; // show a $ / › prompt
  dim?: boolean;
}

export default function Terminal({
  title = 'bimax',
  lines,
  className,
}: {
  title?: string;
  lines: Line[];
  className?: string;
}) {
  return (
    <div className={`liquid-glass-strong overflow-hidden rounded-xl ${className ?? ''}`}>
      {/* title bar */}
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="ml-3 font-mono text-xs text-white/40">{title}</span>
      </div>
      {/* body */}
      <div className="space-y-1.5 p-5 font-mono text-[13px] leading-relaxed">
        {lines.map((l, i) => (
          <div key={i} className={l.dim ? 'text-white/40' : 'text-white/85'}>
            {l.prompt && <span className="mr-2 text-accent">›</span>}
            {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}
