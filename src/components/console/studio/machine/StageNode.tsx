'use client';

import { AlertTriangle, Check, X } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { cn } from '@/components/ui/cn';
import type { StageDef, StageState, StageStatus } from './run';
import type { TagSource } from './signals';

const TONE: Record<StageStatus, string> = {
  idle: 'text-ink-3',
  processing: 'text-signal',
  success: 'text-ok',
  warning: 'text-warn',
  error: 'text-critical',
};

/** The lead figure takes the stage's outcome colour: a larger output is a warning, not a win. */
const EMPHASIS: Record<StageStatus, string> = {
  idle: 'text-ink-2',
  processing: 'text-signal',
  success: 'text-signal',
  warning: 'text-warn',
  error: 'text-critical',
};

const TAG_DOT: Record<TagSource, string> = {
  cloudinary: 'bg-signal',
  pipeline: 'bg-indigo',
  record: 'bg-ink-3',
};

const TAG_SOURCE_LABEL: Record<TagSource, string> = {
  cloudinary: 'Cloudinary signal (this run)',
  pipeline: 'Pipeline integrity',
  record: 'Record',
};

/** Stage latency: sub-millisecond local work reads "<1 ms" rather than a false-precision zero. */
export function formatStageMs(ms: number): string {
  if (ms < 1) return '<1 ms';
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function statusText(def: StageDef, s: StageState): string {
  if (s.halted && s.status === 'idle') return 'Halted';
  switch (s.status) {
    case 'idle':
      return 'Idle';
    case 'processing':
      return 'Processing';
    case 'warning':
      return s.live ? `Rendering · ${s.code ?? '423'}` : s.code ? `Warning · ${s.code}` : 'Warning';
    case 'success':
      return s.code ? `OK · ${s.code}` : def.local ? 'OK · local' : 'OK';
    case 'error':
      return s.code ? `Error · ${s.code}` : 'Error';
  }
}

function Marker({ state }: { state: StageState }) {
  const { status, live } = state;
  return (
    <span
      className={cn(
        'relative z-10 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-300',
        status === 'idle' && 'border-line-strong bg-canvas',
        status === 'processing' && 'border-signal bg-signal',
        status === 'success' && 'border-line-strong bg-raised',
        status === 'warning' && 'border-warn/60 bg-warn/12',
        status === 'error' && 'border-critical/60 bg-critical/12',
      )}
    >
      {live && (
        <span
          aria-hidden
          className={cn('absolute -inset-[4px] animate-pulse-dot rounded-[6px] border', status === 'warning' ? 'border-warn/45' : 'border-signal/45')}
        />
      )}
      {status === 'idle' && <span className="h-1 w-1 rounded-[1px] bg-ink-3/70" />}
      {status === 'processing' && <span className="h-1.5 w-1.5 rounded-[1px] bg-signal-ink" />}
      {status === 'success' && <Check className="h-3 w-3 text-ok" strokeWidth={2.75} />}
      {status === 'warning' && <AlertTriangle className="h-2.5 w-2.5 text-warn" strokeWidth={2.5} />}
      {status === 'error' && <X className="h-3 w-3 text-critical" strokeWidth={2.75} />}
    </span>
  );
}

export function StageNode({
  def,
  index,
  state,
  connector,
  liveRef,
  components,
  horizontal,
  compact = false,
}: {
  def: StageDef;
  index: number;
  state: StageState;
  /** Track to the next stage (omitted on the last stage). */
  connector?: ReactNode;
  /** Receives the live elapsed-time element while this stage is in flight. */
  liveRef: Ref<HTMLSpanElement>;
  /** TRANSFORM lists the transformation components it renders. */
  components?: string[];
  horizontal: boolean;
  /**
   * Phones (below sm): status on the name line, tighter spacing and shorter tag and
   * component lists, so all six stages of a run fit about one screen.
   */
  compact?: boolean;
}) {
  const ran = state.status !== 'idle';
  const tone = state.halted && !ran ? 'text-ink-3' : TONE[state.status];
  const maxTags = horizontal ? 4 : compact ? 2 : 12;
  const maxComponents = horizontal ? 4 : compact ? 2 : 8;

  return (
    <li
      aria-current={state.live ? 'step' : undefined}
      className="relative grid grid-cols-[18px_minmax(0,1fr)] gap-x-4 xl:block"
    >
      {/* Rail: marker + track (vertical below xl, horizontal above). */}
      <div className="flex flex-col items-center xl:h-[18px] xl:flex-row">
        <Marker state={state} />
        {connector}
      </div>

      <div
        className={cn(
          'min-w-0 sm:grid sm:grid-cols-[minmax(0,190px)_minmax(0,1fr)] sm:gap-x-8 xl:block xl:pb-0 xl:pr-5 xl:pt-3.5',
          compact ? (connector ? 'pb-3.5' : 'pb-3') : connector ? 'pb-6' : 'pb-4',
        )}
      >
        <div className={cn('min-w-0', compact && 'flex items-baseline gap-3')}>
          <div className={cn('flex min-w-0 items-baseline gap-2', compact && 'shrink-0')}>
            <span className="num font-mono text-[10px] text-ink-3">{String(index + 1).padStart(2, '0')}</span>
            <span
              className={cn(
                'truncate font-display text-[16px] uppercase leading-none tracking-[0.01em] transition-colors duration-300',
                ran ? 'text-ink' : state.halted ? 'text-ink-3' : 'text-ink-2',
              )}
              style={{ fontVariationSettings: '"wdth" 78, "wght" 720' }}
            >
              {def.name}
            </span>
          </div>
          <div
            className={cn(
              'flex items-baseline justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.08em]',
              compact ? 'min-w-0 flex-1' : 'mt-1.5',
            )}
          >
            <span className={cn('truncate', tone)}>{statusText(def, state)}</span>
            {state.live ? (
              <span key="live" ref={liveRef} className={cn('num shrink-0 normal-case tracking-normal', state.status === 'warning' ? 'text-warn' : 'text-signal')} />
            ) : state.ms !== undefined ? (
              <span key="done" className="num shrink-0 normal-case tracking-normal text-ink-2" title="Measured duration of this stage's operation">
                {formatStageMs(state.ms)}
              </span>
            ) : null}
          </div>
        </div>

        <div className={cn('min-w-0 sm:mt-0 xl:mt-2.5', compact ? 'mt-1.5' : 'mt-2')}>
          {ran ? (
            <p className="line-clamp-2 text-[12.5px] leading-snug text-ink" title={state.result}>
              {state.emphasis && <span className={cn('num mr-1.5 font-medium', EMPHASIS[state.status])}>{state.emphasis}</span>}
              {state.result}
            </p>
          ) : (
            <p className={cn('line-clamp-2 text-[12.5px] leading-snug', state.halted ? 'text-ink-3' : 'text-ink-2')}>
              {state.halted ? 'Not run · upstream failure' : def.plan}
            </p>
          )}
          <p className="mt-0.5 line-clamp-2 font-mono text-[10.5px] leading-relaxed text-ink-3" title={ran ? state.detail : def.planDetail}>
            {ran ? state.detail : def.planDetail}
          </p>

          {state.message && (
            <p
              className={cn(
                'mt-1.5 line-clamp-3 text-[11.5px] leading-snug',
                state.status === 'error' ? 'font-mono text-critical' : 'text-warn',
              )}
              title={state.message}
            >
              {state.message}
            </p>
          )}

          {state.tags && state.tags.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1" aria-label="Derived tags">
              {state.tags.slice(0, maxTags).map((t) => (
                <li
                  key={t.tag}
                  title={TAG_SOURCE_LABEL[t.source]}
                  className="inline-flex h-[18px] max-w-full items-center gap-1 rounded-[4px] border border-line px-1.5 font-mono text-[10px] text-ink-2"
                >
                  <span aria-hidden className={cn('h-1 w-1 shrink-0 rounded-full', TAG_DOT[t.source])} />
                  <span className="truncate">{t.tag}</span>
                </li>
              ))}
              {state.tags.length > maxTags && (
                <li className="inline-flex h-[18px] items-center px-1 font-mono text-[10px] text-ink-3">+{state.tags.length - maxTags}</li>
              )}
            </ul>
          )}

          {components && (
            <ol className="mt-2 space-y-0.5 border-l border-line pl-2 font-mono text-[10.5px] leading-[1.5] text-ink-2" aria-label="Transformation components">
              {components.length === 0 && <li className="text-ink-3">no components · original delivered</li>}
              {components.slice(0, maxComponents).map((c, i) => (
                <li key={`${i}-${c}`} className="truncate" title={c}>
                  {c}
                </li>
              ))}
              {components.length > maxComponents && <li className="text-ink-3">+{components.length - maxComponents} more</li>}
            </ol>
          )}
        </div>
      </div>
    </li>
  );
}
