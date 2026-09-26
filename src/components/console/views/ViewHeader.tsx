import type { ReactNode } from 'react';

export function ViewHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {/* tabIndex -1: the console moves focus here after a view switch (not a tab stop). */}
        <h1 tabIndex={-1} className="text-[22px] font-semibold tracking-[-0.025em] text-ink outline-none">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-[13px] text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
