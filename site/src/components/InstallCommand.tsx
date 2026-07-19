import { Check, Copy, Terminal } from 'lucide-react';
import { useEffect, useState } from 'react';

export const INSTALL_COMMAND = 'curl -fsSL https://bimax-liard.vercel.app/install | bash';

export default function InstallCommand({ className = '' }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = INSTALL_COMMAND;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    setCopied(true);
  };

  return (
    <div className={`install-command liquid-glass liquid-glass-command ${className}`}>
      <div className="install-command-meta">
        <span><i aria-hidden /> Public beta · v1.0.6</span>
        <span>macOS + Linux</span>
      </div>
      <div className="install-command-line">
        <Terminal aria-hidden size={16} strokeWidth={1.8} />
        <code>{INSTALL_COMMAND}</code>
        <button type="button" onClick={copy} aria-label="Copy Bimax install command">
          {copied ? <Check aria-hidden size={15} /> : <Copy aria-hidden size={15} />}
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <p>On first launch, choose your model provider and enter its key in a masked field. Bimax stores it locally.</p>
    </div>
  );
}
