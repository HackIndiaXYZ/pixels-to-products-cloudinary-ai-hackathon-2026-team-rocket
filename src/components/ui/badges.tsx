import type { Category, FindingStatus, Severity } from '@/lib/types';
import { CATEGORY_LABEL, STATUS_LABEL } from '@/lib/analytics';
import { INTEGRITY_HELP, INTEGRITY_LABEL, type Integrity } from '@/lib/cloudinary/pipeline';
import { cn } from './cn';

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'var(--color-critical)',
  high: 'var(--color-high)',
  medium: 'var(--color-medium)',
  low: 'var(--color-low)',
};

export function SeverityDot({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block h-2 w-2 shrink-0 rounded-[2px]', className)}
      style={{ backgroundColor: SEVERITY_COLOR[severity] }}
    />
  );
}

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      className={cn('chip', className)}
      style={{
        color: SEVERITY_COLOR[severity],
        borderColor: `color-mix(in oklab, ${SEVERITY_COLOR[severity]} 38%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${SEVERITY_COLOR[severity]} 9%, transparent)`,
      }}
    >
      <SeverityDot severity={severity} />
      {severity}
    </span>
  );
}

const STATUS_STYLE: Record<FindingStatus, string> = {
  open: 'text-ink border-line-strong',
  monitoring: 'text-ink-2 border-line-strong border-dashed',
  resolved: 'text-ink-3 border-line',
};

export function StatusBadge({ status, className }: { status: FindingStatus; className?: string }) {
  return (
    <span className={cn('chip bg-transparent', STATUS_STYLE[status], className)}>
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          status === 'open' ? 'bg-ink' : status === 'monitoring' ? 'bg-ink-2' : 'bg-ink-3',
        )}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function CategoryTag({ category, className }: { category: Category; className?: string }) {
  return <span className={cn('chip bg-transparent', className)}>{CATEGORY_LABEL[category]}</span>;
}

const INTEGRITY_STYLE: Record<Integrity, string> = {
  evidence: 'text-signal border-[color-mix(in_oklab,var(--color-signal)_35%,transparent)]',
  'ai-edit': 'text-medium border-[color-mix(in_oklab,var(--color-medium)_35%,transparent)]',
  generative: 'text-high border-[color-mix(in_oklab,var(--color-high)_40%,transparent)]',
};

export function IntegrityBadge({ integrity, className }: { integrity: Integrity; className?: string }) {
  return (
    <span className={cn('chip bg-transparent', INTEGRITY_STYLE[integrity], className)} title={INTEGRITY_HELP[integrity]}>
      {INTEGRITY_LABEL[integrity]}
    </span>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('relative inline-flex h-1.5 w-1.5', className)}>
      <span className="absolute inset-0 rounded-full bg-signal animate-pulse-dot" />
    </span>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-line-strong bg-raised px-1.5 font-mono text-[10.5px] text-ink-2',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
