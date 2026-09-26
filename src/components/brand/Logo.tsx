import { cn } from '@/components/ui/cn';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={cn('h-5 w-5', className)}>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
      <circle cx="12" cy="12" r="2.6" fill="var(--color-signal)" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-ink', className)}>
      <LogoMark />
      {!compact && <span className="text-[15px] font-semibold tracking-[-0.02em]">VisualOps</span>}
    </span>
  );
}
