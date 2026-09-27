import { cn } from './cn';

/**
 * Where a fact came from. VisualOps shows this wherever a finding, tag or value is presented:
 *  - ai:     detected by Cloudinary's AI (captioning, object detection, auto-tagging, face detection, g_auto)
 *  - human:  classified by a person (entered at ingest, or team-written for the sample workspace)
 *  - system: derived by VisualOps from the records (counts, rankings, measured delivery)
 */
export type ProvenanceKind = 'ai' | 'human' | 'system';

const LABEL: Record<ProvenanceKind, string> = {
  ai: 'AI detected',
  human: 'Human classified',
  system: 'System derived',
};

const TONE: Record<ProvenanceKind, string> = {
  ai: 'text-signal border-[color-mix(in_oklab,var(--color-signal)_40%,transparent)]',
  human: 'text-indigo border-[color-mix(in_oklab,var(--color-indigo)_45%,transparent)]',
  system: 'text-ink-3 border-line-strong',
};

export function ProvenanceBadge({
  kind,
  detail,
  className,
}: {
  kind: ProvenanceKind;
  /** Optional qualifier, e.g. "Cloudinary" or "sample annotation". */
  detail?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] border px-1.5 py-[1px] font-mono text-[10.5px] uppercase tracking-[0.06em]',
        TONE[kind],
        className,
      )}
      title={`${LABEL[kind]}${detail ? ` · ${detail}` : ''}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {LABEL[kind]}
      {detail && <span className="normal-case tracking-normal opacity-80">· {detail}</span>}
    </span>
  );
}
