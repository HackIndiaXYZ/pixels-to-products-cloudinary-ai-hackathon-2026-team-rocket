'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { MediaAsset } from '@/lib/types';
import { computeRun, DEBOUNCE_MS, normalizeQuery, STAGE_MS, type AskRun, type AskStage } from './engine';

/**
 * The staged search state machine.
 *
 *  - A question runs when typing settles (DEBOUNCE_MS) or on Enter.
 *  - The run is computed synchronously and in full; the stages then reveal what
 *    each step produced, one per STAGE_MS. Under reduced motion they are skipped.
 *  - Results already on screen stay until the new run reaches its final stage,
 *    so evidence is swapped once instead of flickering through every keystroke.
 *
 * State changes happen at most once per stage (four per question) — never per frame.
 */

interface State {
  run: AskRun | null;
  stage: AskStage;
  committed: AskRun | null;
  active: number;
}

type Action =
  | { type: 'start'; run: AskRun; instant: boolean }
  | { type: 'advance'; id: number; stage: AskStage }
  | { type: 'clear' }
  | { type: 'active'; index: number };

const INITIAL: State = { run: null, stage: 0, committed: null, active: 0 };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'start':
      return action.instant
        ? { run: action.run, stage: 4, committed: action.run, active: 0 }
        : { ...state, run: action.run, stage: 1 };
    case 'advance': {
      if (!state.run || state.run.id !== action.id || action.stage <= state.stage) return state;
      return action.stage === 4
        ? { ...state, stage: 4, committed: state.run, active: 0 }
        : { ...state, stage: action.stage };
    }
    case 'clear':
      return INITIAL;
    case 'active':
      return action.index === state.active ? state : { ...state, active: action.index };
  }
}

export type SubmitOutcome = 'empty' | 'started' | 'revealed' | 'ready';

export function useAskSearch({
  pool,
  sites,
  now,
  instant,
}: {
  pool: MediaAsset[];
  sites: string[];
  now: number;
  instant: boolean;
}) {
  const [query, setQueryState] = useState('');
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const seq = useRef(0);
  const lastRunQuery = useRef('');

  const start = useCallback(
    (raw: string): boolean => {
      const q = normalizeQuery(raw);
      if (!q || q === lastRunQuery.current) return false;
      lastRunQuery.current = q;
      seq.current += 1;
      dispatch({ type: 'start', run: computeRun(seq.current, q, pool, sites, now), instant });
      return true;
    },
    [pool, sites, now, instant],
  );

  // Run once typing settles.
  useEffect(() => {
    if (!normalizeQuery(query)) return;
    const timer = window.setTimeout(() => start(query), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, start]);

  // Reveal the stages of the current run.
  const runId = state.run?.id;
  useEffect(() => {
    if (runId === undefined || instant) return;
    const timers = ([2, 3, 4] as const).map((stage, i) =>
      window.setTimeout(() => dispatch({ type: 'advance', id: runId, stage }), STAGE_MS * (i + 1)),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [runId, instant]);

  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    if (!normalizeQuery(value)) {
      lastRunQuery.current = '';
      dispatch({ type: 'clear' });
    }
  }, []);

  /** Runs `value` immediately (examples, facets). */
  const ask = useCallback(
    (value: string) => {
      setQueryState(value);
      start(value);
    },
    [start],
  );

  /** Enter: run the pending question, else reveal the running one, else report that results are ready. */
  const submit = useCallback((): SubmitOutcome => {
    const q = normalizeQuery(query);
    if (!q) return 'empty';
    if (start(q)) return 'started';
    if (state.run && state.stage < 4) {
      dispatch({ type: 'advance', id: state.run.id, stage: 4 });
      return 'revealed';
    }
    return 'ready';
  }, [query, start, state.run, state.stage]);

  const setActive = useCallback((index: number) => dispatch({ type: 'active', index }), []);

  return {
    query,
    setQuery,
    ask,
    submit,
    run: state.run,
    stage: state.stage,
    committed: state.committed,
    active: state.active,
    setActive,
  };
}
