'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from './cn';

export function CopyButton({
  value,
  label = 'Copy',
  className,
  iconOnly = false,
}: {
  value: string;
  label?: string;
  className?: string;
  iconOnly?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard can be unavailable (insecure context); fall back to a selection prompt.
      window.prompt('Copy to clipboard', value);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={cn('btn btn-secondary btn-sm', iconOnly && 'btn-icon', className)}
      aria-label={iconOnly ? label : undefined}
      title={label}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-signal" /> : <Copy className="h-3.5 w-3.5" />}
      {!iconOnly && <span>{copied ? 'Copied' : label}</span>}
    </button>
  );
}
