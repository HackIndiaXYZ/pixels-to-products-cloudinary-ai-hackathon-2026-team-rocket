/**
 * The console's address lives in the URL hash, so every view and every open
 * record can be linked, bookmarked and reached with Back/Forward:
 *
 *   #library                   a view
 *   #library/vo-road-collapse  a view with the Inspector open on a record
 *   #studio/vo-crew-ppe        Studio working on an asset
 *
 * Studio's hash already names the asset on the bench, so an Inspector opened
 * over Studio is recorded in the history entry's state instead of the hash.
 *
 * Entries are written with the native History API, which Next.js integrates
 * with (it copies its router state onto the entry and keeps its canonical URL
 * in step). pushState/replaceState fire no events, so every writer applies the
 * new entry to React state itself; hashchange/popstate cover everything else.
 */

export type View = 'overview' | 'library' | 'incidents' | 'studio' | 'reports';
export const VIEWS: View[] = ['overview', 'library', 'incidents', 'studio', 'reports'];

export interface HashRoute {
  view: View;
  assetId?: string;
}

export function parseHash(hash: string): HashRoute {
  const [head, ...rest] = hash.replace(/^#\/?/, '').split('/');
  const view = VIEWS.includes(head as View) ? (head as View) : 'overview';
  let assetId: string | undefined;
  if (rest.length) {
    try {
      assetId = decodeURIComponent(rest.join('/')) || undefined;
    } catch {
      assetId = undefined; // malformed escape in a hand-edited URL
    }
  }
  return { view, assetId };
}

export function hashFor(view: View, assetId?: string | null): string {
  return `#${view}${assetId ? `/${encodeURIComponent(assetId)}` : ''}`;
}

/** History-state key marking an entry VisualOps pushed to open the Inspector; the value is the record id. */
const INSPECTOR_KEY = 'voInspector';
/** History-state key holding the page's scroll offset when the user left the entry for another view. */
const SCROLL_KEY = 'voScroll';

export interface HistoryEntry extends HashRoute {
  /** Record id when VisualOps pushed this entry for the Inspector (so closing it can step back). */
  marker: string | null;
  /** Record the Inspector shows for this entry, or null. */
  inspecting: string | null;
  /** Scroll offset to restore when Back/Forward returns to this entry's view, if one was saved. */
  scroll: number | null;
}

export function readEntry(): HistoryEntry {
  const route = parseHash(window.location.hash);
  const state = window.history.state as Record<string, unknown> | null;
  const value = state?.[INSPECTOR_KEY];
  const marker = typeof value === 'string' && value ? value : null;
  const inspecting = route.view === 'studio' ? marker : (route.assetId ?? null);
  const saved = state?.[SCROLL_KEY];
  const scroll = typeof saved === 'number' && Number.isFinite(saved) ? saved : null;
  return { ...route, marker, inspecting, scroll };
}

export function writeEntry(mode: 'push' | 'replace', url: string, marker: string | null = null, scroll: number | null = null): void {
  // Only our own keys: Next.js merges its router state into whatever we pass.
  const own: Record<string, string | number> = {};
  if (marker) own[INSPECTOR_KEY] = marker;
  if (scroll !== null) own[SCROLL_KEY] = scroll;
  const state = Object.keys(own).length ? own : null;
  if (mode === 'push') window.history.pushState(state, '', url);
  else window.history.replaceState(state, '', url);
}

/** Saves the current scroll offset on the current entry before the console moves to another view. */
export function rememberScroll(): void {
  const current = readEntry();
  writeEntry('replace', window.location.href, current.marker, Math.round(window.scrollY));
}
