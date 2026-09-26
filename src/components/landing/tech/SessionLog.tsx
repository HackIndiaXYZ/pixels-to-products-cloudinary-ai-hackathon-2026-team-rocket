'use client';

import { motion } from 'framer-motion';
import { getActivity, getServerActivity, subscribeActivity, type ActivityKind } from '@/lib/cloudinary/probe';
import { useClientValue } from '@/components/motion/hooks';
import { cn } from '@/components/ui/cn';

const KIND: Record<ActivityKind, { label: string; cls: string }> = {
  delivered: { label: 'OK', cls: 'text-ok' },
  processing: { label: '423', cls: 'text-warn' },
  error: { label: 'ERR', cls: 'text-critical' },
  insight: { label: 'JSON', cls: 'text-indigo' },
};

const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

/**
 * Tail of the session activity log: every Cloudinary response this browser tab
 * has received so far (delivery probes and fl_getinfo calls from any section).
 * Empty on the server and during hydration (the hero may already have logged
 * responses by the time this section hydrates); the log follows as a
 * transition, so hydration never forces a synchronous re-render here.
 */
export function SessionLog({ rows = 4 }: { rows?: number }) {
  const events = useClientValue(getServerActivity(), getActivity, subscribeActivity);
  const shown = events.slice(0, rows);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,10fr)] lg:gap-6">
      <div>
        <p className="label">Session log</p>
        <p className="mt-2 max-w-[22ch] text-[12.5px] leading-snug text-ink-3">
          Cloudinary responses received by this tab, newest first.
          {events.length > 0 && (
            <span className="num text-ink-2">
              {' '}
              {events.length >= 80 ? '80+' : events.length} so far.
            </span>
          )}
        </p>
      </div>
      <ol className="min-h-[124px] font-mono text-[11px] leading-none" aria-live="off">
        {shown.length === 0 && (
          <li className="flex h-[31px] items-center border-t border-line text-ink-3">Waiting for the first response…</li>
        )}
        {shown.map((e) => (
          <motion.li
            key={e.id}
            layout="position"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="grid h-[31px] grid-cols-[58px_40px_minmax(0,1fr)] items-center gap-3 border-t border-line text-ink-3 sm:grid-cols-[62px_40px_minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,1.2fr)]"
          >
            <span className="num">{clock.format(e.at)}</span>
            <span className={cn('num font-semibold', KIND[e.kind].cls)}>
              {e.kind === 'delivered' && e.metrics ? e.metrics.status : KIND[e.kind].label}
            </span>
            <span className="truncate text-ink-2 sm:hidden">{e.detail}</span>
            <span className="hidden truncate text-ink-2 sm:block" title={e.subject}>
              {e.subject.split('/').pop()}
            </span>
            <span className="hidden truncate sm:block" title={e.transformation}>
              {e.transformation || '—'}
            </span>
            <span className="num hidden truncate text-right text-ink-2 sm:block">{e.detail}</span>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}
