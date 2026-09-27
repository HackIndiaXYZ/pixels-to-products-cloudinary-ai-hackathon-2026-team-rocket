import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';

/** House easing: fast out, long settle. */
export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** First sentence of an annotation, for one-line summaries. */
export function firstSentence(text: string): string {
  const match = text.match(/^.+?[.!?](?=\s|$)/);
  return (match ? match[0] : text).trim();
}

/** Transformation components of a Cloudinary delivery URL, e.g. "c_limit,w_1600 / q_auto / f_auto". */
export function transformationOf(url: string): string {
  const m = url.match(/\/(?:image|video)\/upload\/(.*)$/);
  if (!m) return '';
  return m[1]
    .split('/')
    .filter((part) => /^[a-z]{1,3}_[^/]*$/.test(part) && !part.includes('.'))
    .join(' / ');
}

/** Last path segment of a public id (with any extension removed). */
export function publicIdTail(value: string): string {
  const last = value.split('/').pop() ?? value;
  return last.replace(/\.[a-z0-9]{2,5}$/i, '');
}

export function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Rounds an axis maximum up to a clean value (100, 200, 250, 500, 1000 …). */
export function niceCeil(value: number): number {
  if (value <= 0) return 100;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * exp) return step * exp;
  }
  return 10 * exp;
}

/** Compact age for live events: "now", "8s", "4m", "2h". */
export function shortAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 3) return 'now';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

/** Section title row used inside overview panels. */
export function PanelTitle({
  title,
  meta,
  className,
  id,
}: {
  title: ReactNode;
  meta?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={cn('flex min-h-[20px] items-baseline justify-between gap-3', className)}>
      <h2 id={id} className="text-[13px] font-semibold tracking-[-0.005em] text-ink">
        {title}
      </h2>
      {meta && <div className="num shrink-0 truncate font-mono text-[11px] text-ink-3">{meta}</div>}
    </div>
  );
}

/** Legend swatch (identity is carried by the mark, text stays in ink). */
export function Swatch({ color, hollow = false, className }: { color: string; hollow?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block h-2 w-2 shrink-0 rounded-[2px]', className)}
      style={hollow ? { boxShadow: `inset 0 0 0 1.5px ${color}` } : { backgroundColor: color }}
    />
  );
}
