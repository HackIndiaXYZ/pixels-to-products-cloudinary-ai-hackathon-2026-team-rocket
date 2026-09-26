'use client';

import { useSyncExternalStore } from 'react';

/**
 * The Library's current record order, shared with the Inspector so ← / → step
 * through exactly what the viewer was looking at.
 *
 * Two inputs make it up:
 * - the result order (after filters and sort), published by the Library view;
 * - the on-screen order of the rendered page, published by the mosaic grid,
 *   whose explicit placement reads row by row and so can differ from the
 *   result order.
 *
 * The sequence is the on-screen order of the rendered tiles, followed by the
 * results that are not rendered yet (in result order). Either input can be
 * published first; the combination is recomputed on every publish.
 */

const EMPTY: readonly string[] = [];
let results: readonly string[] = EMPTY;
let display: readonly string[] = EMPTY;
let sequence: readonly string[] = EMPTY;
const listeners = new Set<() => void>();

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function recompute(): void {
  let next: readonly string[] = results;
  if (display.length && results.length) {
    const inResults = new Set(results);
    const head = display.filter((id) => inResults.has(id));
    const shown = new Set(head);
    next = [...head, ...results.filter((id) => !shown.has(id))];
  }
  if (same(next, sequence)) return;
  sequence = next.length ? next : EMPTY;
  listeners.forEach((listener) => listener());
}

/** The Library's result order (every match, rendered or not). Publish [] when the Library unmounts. */
export function publishLibrarySequence(ids: readonly string[]): void {
  if (same(ids, results)) return;
  results = ids;
  recompute();
}

/** The on-screen order of the rendered tiles (reading order). Publish [] when the grid unmounts. */
export function publishLibraryDisplayOrder(ids: readonly string[]): void {
  if (same(ids, display)) return;
  display = ids;
  recompute();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLibrarySequence(): readonly string[] {
  return useSyncExternalStore(
    subscribe,
    () => sequence,
    () => EMPTY,
  );
}
