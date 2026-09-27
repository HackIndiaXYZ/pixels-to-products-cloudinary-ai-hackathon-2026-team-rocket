'use client';

import { Loader2, Play, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { MediaAsset } from '@/lib/types';
import { pipelineComponents, pipelineIntegrity, type PipelineStep } from '@/lib/cloudinary/pipeline';
import { formatMs, pluralize } from '@/lib/format';
import { useInViewport, useRafLoop, useReducedMotionPref } from '@/components/motion/hooks';
import { IntegrityBadge } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { Connector } from './machine/Connector';
import { StageNode } from './machine/StageNode';
import { STAGE_IDS, runMachine, stagesFor, type RunOutcome, type StageDef, type StageId, type StageState } from './machine/run';
import { useMediaQuery } from './machine/useMediaQuery';

/** Presentational pause between stages while the hand-off packet travels; never counted in measured time. */
const PACE_MS = 220;
/** Sticky console header (52 px) plus breathing room; matches the section's scroll-margin. */
const HEADER_CLEARANCE = 60;
/** The fixed bottom tab bar below `lg`. */
const TAB_BAR = 56;

type Phase = 'ready' | 'running' | 'complete' | 'halted';

interface MachineState {
  runId: number;
  phase: Phase;
  stages: Record<StageId, StageState>;
  outcome: RunOutcome | null;
}

type Action =
  | { type: 'start' }
  | { type: 'update'; id: StageId; patch: Partial<StageState> }
  | { type: 'finish'; outcome: RunOutcome }
  | { type: 'crash'; message: string };

const idleStages = (): Record<StageId, StageState> =>
  Object.fromEntries(STAGE_IDS.map((id) => [id, { status: 'idle', live: false }])) as Record<StageId, StageState>;

const initialState = (): MachineState => ({ runId: 0, phase: 'ready', stages: idleStages(), outcome: null });

function reducer(state: MachineState, action: Action): MachineState {
  switch (action.type) {
    case 'start':
      return { runId: state.runId + 1, phase: 'running', stages: idleStages(), outcome: null };
    case 'update':
      return { ...state, stages: { ...state.stages, [action.id]: { ...state.stages[action.id], ...action.patch } } };
    case 'finish':
      return { ...state, phase: action.outcome.kind === 'complete' ? 'complete' : 'halted', outcome: action.outcome };
    case 'crash': {
      const at = STAGE_IDS.find((id) => state.stages[id].live) ?? STAGE_IDS[0];
      const stages = { ...state.stages, [at]: { ...state.stages[at], status: 'error' as const, live: false, code: 'ERR', result: 'Stage failed', message: action.message } };
      const totalMs = STAGE_IDS.reduce((sum, id) => sum + (stages[id].ms ?? 0), 0);
      return { ...state, phase: 'halted', stages, outcome: { kind: 'halted', at, totalMs, requests: 0 } };
    }
  }
}

const liveText = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

const OUTCOME_WORD: Partial<Record<StageState['status'], string>> = {
  success: 'done',
  warning: 'warning',
  error: 'failed',
};

/**
 * The stage the header names while running. During a hand-off no stage is live;
 * the label stays on the furthest stage reached (the one the packet travels to)
 * instead of dropping to a generic "Running".
 */
function currentStageIndex(stages: Record<StageId, StageState>): number {
  const live = STAGE_IDS.findIndex((id) => stages[id].live);
  if (live >= 0) return live;
  for (let i = STAGE_IDS.length - 1; i >= 0; i -= 1) {
    const s = stages[STAGE_IDS[i]];
    if (s.incoming || s.status !== 'idle') return i;
  }
  return 0;
}

/**
 * What the screen reader hears: one line per stage when it settles (plus the
 * 423 "rendering" state, which can last minutes), then the outcome. Hand-offs
 * and the start of each stage are not announced.
 */
function announcement(state: MachineState, stages: StageDef[], summary: string): string {
  if (state.phase === 'ready') return '';
  if (state.phase !== 'running' && state.outcome) return `Pipeline ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`;
  for (let i = STAGE_IDS.length - 1; i >= 0; i -= 1) {
    const def = stages[i];
    const s = state.stages[def.id];
    if (s.live && s.status === 'warning') return `${def.name}: ${s.result ?? 'rendering asynchronously'}`;
    const word = !s.live ? OUTCOME_WORD[s.status] : undefined;
    if (word) return [`${def.name} ${word}`, s.result, s.status !== 'success' && s.message].filter(Boolean).join('. ');
  }
  return '';
}

/**
 * The pipeline machine: INGEST → UNDERSTAND → CLASSIFY → TRANSFORM → OPTIMIZE → INDEX,
 * executed live for the Studio's asset and steps. Every figure it shows is
 * measured in this run — Cloudinary response headers, Cloudinary AI (the stored
 * understanding or a fresh analysis of the team's photo, and fl_getinfo JSON),
 * the Search API lookup, or local computation timed in the browser. Every label
 * says whether it is human classified, AI detected or system derived.
 *
 * Re-renders happen only on stage transitions; the running stage's clock is
 * written straight to the DOM from a rAF loop that runs only while a stage is
 * in flight and the machine is on screen.
 */
export function PipelineMachine({
  asset,
  steps,
  assets,
  now,
  team,
  onAnalysed,
  className,
}: {
  asset: MediaAsset;
  steps: PipelineStep[];
  assets: MediaAsset[];
  now: number;
  /** The record lives in the team's Cloudinary cloud (the server can analyse it and look it up in Search). */
  team: boolean;
  /** Receives the record once UNDERSTAND has stored Cloudinary AI understanding on it. */
  onAnalysed?: (asset: MediaAsset) => void;
  className?: string;
}) {
  const reduce = useReducedMotionPref();
  const horizontal = useMediaQuery('(min-width: 1280px)');
  const compact = useMediaQuery('(max-width: 639px)');
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const controller = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const liveRef = useRef<HTMLSpanElement>(null);
  const lastWrite = useRef(0);
  const inView = useInViewport(rootRef);

  const integrity = pipelineIntegrity(steps, asset);
  const components = useMemo(() => pipelineComponents(steps, asset), [steps, asset]);
  const analysed = Boolean(asset.ai);
  const stages = useMemo(() => stagesFor({ team, resourceType: asset.resourceType, analysed }), [team, asset.resourceType, analysed]);
  const networkStages = stages.filter((s) => !s.local).length;

  // The machine is keyed by asset + pipeline URL, so a change remounts it; abort whatever was in flight.
  useEffect(() => () => controller.current?.abort(), []);

  const activeId = STAGE_IDS.find((id) => state.stages[id].live);
  const activeStart = activeId ? state.stages[activeId].startedAt : undefined;

  useRafLoop((time) => {
    const el = liveRef.current;
    if (!el || activeStart === undefined) return;
    if (el.textContent && time - lastWrite.current < 50) return;
    lastWrite.current = time;
    const text = liveText(Math.max(0, performance.now() - activeStart));
    if (el.textContent !== text) el.textContent = text;
  }, activeStart !== undefined && inView);

  const running = state.phase === 'running';

  const run = () => {
    // aria-disabled rather than disabled: the button keeps focus through the run (and reads "Run again" after).
    if (running) return;
    const root = rootRef.current;
    if (root && !horizontal) {
      // Stacked layout: start the run with the machine at the top of the screen, once — no follow-scrolling.
      const r = root.getBoundingClientRect();
      const bottomLimit = window.innerHeight - (window.matchMedia('(min-width: 1024px)').matches ? 0 : TAB_BAR);
      const hiddenTop = r.top < HEADER_CLEARANCE - 8;
      const hiddenBottom = r.bottom > bottomLimit && r.top > HEADER_CLEARANCE + 8;
      if (hiddenTop || hiddenBottom) root.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    }
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    dispatch({ type: 'start' });
    runMachine(
      { asset, steps, assets, now, team, onAnalysed },
      {
        signal: ctrl.signal,
        pace: reduce ? 0 : PACE_MS,
        update: (id, patch) => {
          if (!ctrl.signal.aborted) dispatch({ type: 'update', id, patch });
        },
      },
    )
      .then((outcome) => {
        if (outcome && !ctrl.signal.aborted) dispatch({ type: 'finish', outcome });
      })
      .catch((error: unknown) => {
        if (!ctrl.signal.aborted) dispatch({ type: 'crash', message: error instanceof Error ? error.message : String(error) });
      });
  };

  const outcome = state.outcome;

  let summary: string;
  if (state.phase === 'ready') {
    summary = `Ready · ${networkStages} of ${stages.length} stages call Cloudinary live`;
  } else if (running || !outcome) {
    const index = currentStageIndex(state.stages);
    summary = `Stage ${index + 1} of ${stages.length} · ${stages[index].name}`;
  } else if (outcome.kind === 'complete') {
    summary = [
      'Complete',
      `${formatMs(outcome.totalMs)} measured`,
      pluralize(outcome.requests, 'request'),
      outcome.warnings > 0 && pluralize(outcome.warnings, 'warning'),
    ]
      .filter(Boolean)
      .join(' · ');
  } else {
    summary = `Stopped at ${stages[STAGE_IDS.indexOf(outcome.at)].name} · ${formatMs(outcome.totalMs)} measured`;
  }
  const spoken = announcement(state, stages, summary);

  return (
    <section ref={rootRef} aria-label="Pipeline machine" className={cn('panel scroll-mt-[60px] overflow-hidden', className)}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="label text-ink-2">Pipeline machine</span>
          <span aria-hidden className="h-3 w-px bg-line-strong" />
          <span className="truncate font-mono text-[11.5px] text-ink-3">{asset.fileName}</span>
          <IntegrityBadge integrity={integrity} className="hidden sm:inline-flex" />
        </div>
        {/* On phones the summary stays left and the button stays pinned right, whatever the status text says. */}
        <div className="flex w-full min-w-0 items-center justify-between gap-3 sm:w-auto sm:justify-end">
          {/* Visual status only; the live region below announces stage completions. */}
          <span
            className={cn(
              'num min-w-0 font-mono text-[11px] leading-snug',
              state.phase === 'halted'
                ? 'text-critical'
                : outcome?.kind === 'complete'
                  ? outcome.warnings > 0
                    ? 'text-warn'
                    : 'text-ok'
                  : 'text-ink-3',
            )}
          >
            {summary}
          </span>
          <button
            type="button"
            onClick={run}
            aria-disabled={running || undefined}
            className="btn btn-primary btn-sm shrink-0 aria-disabled:cursor-progress aria-disabled:opacity-60 aria-disabled:shadow-none aria-disabled:hover:bg-signal aria-disabled:active:transform-none"
          >
            {running ? (
              <>
                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> Running
              </>
            ) : state.phase === 'ready' ? (
              <>
                <Play aria-hidden className="h-3.5 w-3.5" /> Run pipeline
              </>
            ) : (
              <>
                <RotateCcw aria-hidden className="h-3.5 w-3.5" /> Run again
              </>
            )}
          </button>
        </div>
        <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {spoken}
        </p>
      </header>

      <ol className="grid grid-cols-1 px-4 pt-5 xl:grid-cols-6 xl:pb-5">
        {stages.map((def, i) => {
          const next = stages[i + 1];
          return (
            <StageNode
              key={def.id}
              def={def}
              index={i}
              state={state.stages[def.id]}
              horizontal={horizontal}
              compact={compact}
              liveRef={liveRef}
              components={def.id === 'transform' ? components : undefined}
              connector={
                next ? (
                  <Connector
                    lit={Boolean(state.stages[next.id].incoming) || state.stages[next.id].status !== 'idle'}
                    runId={state.runId}
                    horizontal={horizontal}
                    reduce={reduce}
                  />
                ) : undefined
              }
            />
          );
        })}
      </ol>

      <footer className="border-t border-line px-4 py-2 text-[11.5px] leading-relaxed text-ink-3">
        Runs live against Cloudinary: HEAD requests read <span className="font-mono text-[10.5px] text-ink-2">Server-Timing</span> and{' '}
        <span className="font-mono text-[10.5px] text-ink-2">X-Cld-Error</span>;{' '}
        {team && asset.resourceType === 'image' ? (
          <>
            Understand uses the AI caption and objects stored on the asset, or asks the VisualOps server to run Cloudinary AI Content
            Analysis once (<span className="font-mono text-[10.5px] text-ink-2">captioning · coco_v2</span>, 2 detections), plus{' '}
          </>
        ) : (
          <>Understand runs </>
        )}
        <span className="font-mono text-[10.5px] text-ink-2">fl_getinfo</span> for face detections and where g_auto places a 1:1 crop
        {team ? '' : ' — AI Content Analysis runs on the team’s own cloud, not on these demo-cloud samples'}. Classify labels every tag as human
        classified, AI detected or system derived;{' '}
        {team ? (
          <>
            Index looks the record up in Cloudinary’s Search index (<span className="font-mono text-[10.5px] text-ink-2">/api/assets</span>) and
            runs the console’s own search.
          </>
        ) : (
          <>Index runs the console’s own search in this browser.</>
        )}{' '}
        Times are per operation; hand-off animation is not counted. Cached, stored or already in-flight answers are labelled and not counted
        as requests.
      </footer>
    </section>
  );
}
