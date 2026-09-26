'use client';

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { CloudSettings, MediaAsset } from '@/lib/types';
import { buildSampleAssets } from '@/lib/data/dataset';
import { ENV_SETTINGS } from '@/lib/cloudinary/config';
import { defaultPresetFor, presetSteps, type PipelineStep } from '@/lib/cloudinary/pipeline';
import { DEFAULT_SCOPE, type ReportKind, type ReportScope } from '@/lib/report';
import { hashFor, parseHash, readEntry, rememberScroll, writeEntry, type HistoryEntry, type View } from './state/history';

export { VIEWS, type View } from './state/history';

/** The view on screen. The Inspector's record is not part of it, so opening a record never re-renders the views. */
export interface Route {
  view: View;
}

const USER_ASSETS_KEY = 'visualops.userAssets.v1';
const SETTINGS_KEY = 'visualops.settings.v1';
const DEFAULT_STUDIO_ASSET = 'vo-road-collapse';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode, quota) — the session still works */
  }
}

// ---- context shapes -------------------------------------------------------

/** Dataset and Cloudinary settings. Changes when assets are added/removed or settings are saved. */
export interface ConsoleData {
  now: number;
  assets: MediaAsset[];
  userAssets: MediaAsset[];
  getAsset: (id: string | undefined | null) => MediaAsset | undefined;
  addUserAssets: (assets: MediaAsset[]) => void;
  removeUserAsset: (id: string) => void;
  settings: CloudSettings;
  setSettings: (settings: CloudSettings) => void;
  resetSettings: () => void;
  settingsOverridden: boolean;
}

/** Where the console is and what Studio/Reports are working on. Changes on view switches and Studio/Report edits. */
export interface ConsoleRoute {
  route: Route;
  navigate: (view: View, assetId?: string) => void;
  studioAssetId: string;
  studioSteps: PipelineStep[];
  setStudioAsset: (id: string) => void;
  setStudioSteps: (steps: PipelineStep[]) => void;
  openInStudio: (id: string, steps?: PipelineStep[]) => void;
  reportKind: ReportKind;
  setReportKind: (kind: ReportKind) => void;
  reportScope: ReportScope;
  setReportScope: (scope: ReportScope) => void;
  reportFor: (assetIds: string[], kind?: ReportKind) => void;
}

/** Overlays: Inspector, Ask, Ingest, Settings, Studio export. Changes whenever one opens or closes. */
export interface ConsoleUi {
  inspectId: string | null;
  /** Opens (id) or programmatically clears (null) the Inspector and records it in the URL. Never traverses history. */
  inspect: (id: string | null) => void;
  /** User-initiated close (Esc, ✕, breadcrumb): steps Back when the Inspector pushed the entry, so Forward reopens it. */
  closeInspector: () => void;
  paletteOpen: boolean;
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
  ingestOpen: boolean;
  setIngestOpen: Dispatch<SetStateAction<boolean>>;
  settingsOpen: boolean;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  exportOpen: boolean;
  setExportOpen: Dispatch<SetStateAction<boolean>>;
}

/** Every stable callback. The value never changes, so reading it never causes a re-render. */
export interface ConsoleActions {
  navigate: ConsoleRoute['navigate'];
  openInStudio: ConsoleRoute['openInStudio'];
  reportFor: ConsoleRoute['reportFor'];
  setStudioAsset: ConsoleRoute['setStudioAsset'];
  setReportKind: ConsoleRoute['setReportKind'];
  setReportScope: ConsoleRoute['setReportScope'];
  inspect: ConsoleUi['inspect'];
  closeInspector: ConsoleUi['closeInspector'];
  setPaletteOpen: ConsoleUi['setPaletteOpen'];
  setIngestOpen: ConsoleUi['setIngestOpen'];
  setSettingsOpen: ConsoleUi['setSettingsOpen'];
  setExportOpen: ConsoleUi['setExportOpen'];
  addUserAssets: ConsoleData['addUserAssets'];
  removeUserAsset: ConsoleData['removeUserAsset'];
  setSettings: ConsoleData['setSettings'];
  resetSettings: ConsoleData['resetSettings'];
}

export type ConsoleContextValue = ConsoleData & ConsoleRoute & ConsoleUi;

const DataContext = createContext<ConsoleData | null>(null);
const RouteContext = createContext<ConsoleRoute | null>(null);
const UiContext = createContext<ConsoleUi | null>(null);
const ActionsContext = createContext<ConsoleActions | null>(null);

function required<T>(value: T | null, hook: string): T {
  if (!value) throw new Error(`${hook} must be used inside <ConsoleProvider>`);
  return value;
}

export function useConsoleData(): ConsoleData {
  return required(useContext(DataContext), 'useConsoleData');
}

export function useConsoleRoute(): ConsoleRoute {
  return required(useContext(RouteContext), 'useConsoleRoute');
}

export function useConsoleUi(): ConsoleUi {
  return required(useContext(UiContext), 'useConsoleUi');
}

export function useConsoleActions(): ConsoleActions {
  return required(useContext(ActionsContext), 'useConsoleActions');
}

/**
 * Everything at once, for compatibility. It subscribes to all contexts, so the
 * caller re-renders on any change (opening Ask, the Inspector, a dialog…).
 * Prefer the narrow hooks above in anything that renders often.
 */
export function useConsole(): ConsoleContextValue {
  const data = useConsoleData();
  const route = useConsoleRoute();
  const ui = useConsoleUi();
  return useMemo(() => ({ ...data, ...route, ...ui }), [data, route, ui]);
}

// ---- provider -------------------------------------------------------------

export function ConsoleProvider({ children }: { children: ReactNode }) {
  // Client-only provider (see ConsoleRoot): Date.now, localStorage and the URL are safe here.
  const [now] = useState(() => Date.now());
  const [samples] = useState(() => buildSampleAssets(now));
  const [userAssets, setUserAssets] = useState<MediaAsset[]>(() => readJson<MediaAsset[]>(USER_ASSETS_KEY, []));
  const [settingsOverride, setSettingsOverride] = useState<CloudSettings | null>(() =>
    readJson<CloudSettings | null>(SETTINGS_KEY, null),
  );

  // Seeded from the URL at first render; the layout effect below re-reads it before paint, because a
  // client-side navigation into /console#… renders this provider before Next.js writes the new URL.
  const [route, setRoute] = useState<Route>(() => ({ view: parseHash(window.location.hash).view }));
  const [inspectId, setInspectId] = useState<string | null>(() => readEntry().inspecting);
  const [studioAssetId, setStudioAssetId] = useState<string>(() => {
    const r = parseHash(window.location.hash);
    return r.view === 'studio' && r.assetId ? r.assetId : DEFAULT_STUDIO_ASSET;
  });
  const [pipelines, setPipelines] = useState<Record<string, PipelineStep[]>>({});

  const [reportKind, setReportKind] = useState<ReportKind>('inspection');
  const [reportScope, setReportScope] = useState<ReportScope>(DEFAULT_SCOPE);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // ---- routing ------------------------------------------------------------

  /** The committed view, for callbacks (a pending transition may not have rendered yet). */
  const shownView = useRef<View>(route.view);
  /** Where to scroll once the next view has committed (not while the old one is still up); null leaves it. */
  const scrollOnCommit = useRef<number | null>(null);
  /**
   * True while the current entry is one inspect() pushed in this session. Backs up the history-state marker,
   * which a Next.js router refresh (dev HMR, for one) can rewrite away.
   */
  const pushedInspector = useRef(false);

  useLayoutEffect(() => {
    shownView.current = route.view;
    const top = scrollOnCommit.current;
    if (top === null) return;
    scrollOnCommit.current = null;
    // Instant: html has scroll-behavior: smooth, which would drift the new view upward for ~500 ms.
    window.scrollTo({ top, behavior: 'instant' });
  }, [route.view]);

  /** Puts a history entry on screen. A view change is a transition, so mounting the next view never blocks input. */
  const apply = useCallback((entry: HistoryEntry, urgent = false) => {
    const commit = () => {
      setRoute((prev) => (prev.view === entry.view ? prev : { view: entry.view }));
      if (entry.view === 'studio' && entry.assetId) setStudioAssetId(entry.assetId);
      setInspectId(entry.inspecting);
    };
    if (urgent || entry.view === shownView.current) commit();
    else startTransition(commit);
  }, []);

  // URL → state: on mount (before paint), on hash edits and on Back/Forward. Reads window.location, not
  // event.newURL, so a queued hashchange can never re-apply an entry that has since been replaced.
  useLayoutEffect(() => {
    const path = window.location.pathname;
    const sync = () => {
      if (window.location.pathname !== path) return; // leaving the console: Next.js owns this traversal
      // An entry the browser made itself (address-bar edit, plain #anchor) carries no router state. Adopting it
      // keeps Next.js's canonical URL in step, so its next history write can't restore a stale hash.
      if (!window.history.state) window.history.replaceState(null, '', window.location.href);
      pushedInspector.current = false;
      const entry = readEntry();
      // The browser restores scroll before the other view has rendered, so it clamps; restore it after commit.
      if (entry.view !== shownView.current) scrollOnCommit.current = entry.scroll ?? 0;
      apply(entry);
    };
    apply(readEntry(), true);
    // Next.js leaves the scroll alone when a link's #fragment names no element (every console hash), so a link
    // clicked halfway down the landing page would otherwise open the console halfway down too.
    if (window.scrollY) window.scrollTo({ top: 0, behavior: 'instant' });
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, [apply]);

  const navigate = useCallback(
    (view: View, assetId?: string) => {
      const url = hashFor(view, assetId);
      const leaving = view !== shownView.current;
      // A new entry unless we're already exactly there (an Inspector over Studio shares Studio's URL).
      if (window.location.hash !== url || readEntry().marker) {
        if (leaving) rememberScroll(); // so Back returns to the same place in this view
        writeEntry('push', url);
        pushedInspector.current = false;
      }
      if (leaving) {
        scrollOnCommit.current = 0;
      } else {
        scrollOnCommit.current = null;
        window.scrollTo({ top: 0, behavior: 'instant' });
      }
      apply(readEntry());
    },
    [apply],
  );

  const inspect = useCallback((id: string | null) => {
    const current = readEntry();
    if (id) {
      if (current.inspecting !== id) {
        const url = current.view === 'studio' ? window.location.hash || hashFor('studio') : hashFor(current.view, id);
        // Stepping between records replaces the entry; opening one pushes, so Back closes it.
        if (current.inspecting) writeEntry('replace', url, current.marker || pushedInspector.current ? id : null);
        else {
          writeEntry('push', url, id);
          pushedInspector.current = true;
        }
      }
    } else if (current.inspecting) {
      // Programmatic clear (report, studio, remove…): drop the record from the URL without traversing history.
      writeEntry('replace', current.view === 'studio' ? window.location.hash : hashFor(current.view));
      pushedInspector.current = false;
    }
    setInspectId(id);
  }, []);

  const closeInspector = useCallback(() => {
    if (readEntry().marker || pushedInspector.current) {
      pushedInspector.current = false;
      setInspectId(null);
      window.history.back(); // popstate re-syncs; Forward reopens the record
    } else {
      inspect(null); // opened from a pasted link: nothing of ours to step back to
    }
  }, [inspect]);

  // ---- data ---------------------------------------------------------------

  const assets = useMemo(() => [...userAssets, ...samples], [userAssets, samples]);
  const getAsset = useCallback((id: string | undefined | null) => (id ? assets.find((a) => a.id === id) : undefined), [assets]);

  const addUserAssets = useCallback((incoming: MediaAsset[]) => {
    setUserAssets((prev) => {
      const byId = new Map(prev.map((a) => [a.id, a]));
      incoming.forEach((a) => byId.set(a.id, a));
      const next = Array.from(byId.values()).sort((a, b) => +new Date(b.capturedAt) - +new Date(a.capturedAt));
      writeJson(USER_ASSETS_KEY, next);
      return next;
    });
  }, []);

  const removeUserAsset = useCallback((id: string) => {
    setUserAssets((prev) => {
      const next = prev.filter((a) => a.id !== id);
      writeJson(USER_ASSETS_KEY, next);
      return next;
    });
  }, []);

  const settings = settingsOverride ?? ENV_SETTINGS;
  const setSettings = useCallback((next: CloudSettings) => {
    setSettingsOverride(next);
    writeJson(SETTINGS_KEY, next);
  }, []);
  const resetSettings = useCallback(() => {
    setSettingsOverride(null);
    try {
      window.localStorage.removeItem(SETTINGS_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // ---- studio & reports ---------------------------------------------------

  const studioAsset = useMemo(() => getAsset(studioAssetId) ?? samples[0], [getAsset, studioAssetId, samples]);
  const studioPipeline = pipelines[studioAsset.id];
  // Memoised so the steps (and their ids) stay stable until the asset or pipeline actually changes.
  const studioSteps = useMemo(() => studioPipeline ?? presetSteps(defaultPresetFor(studioAsset)), [studioPipeline, studioAsset]);
  const setStudioSteps = useCallback(
    (steps: PipelineStep[]) => setPipelines((prev) => ({ ...prev, [studioAsset.id]: steps })),
    [studioAsset.id],
  );
  const setStudioAsset = useCallback((id: string) => {
    setStudioAssetId(id);
    const current = readEntry();
    if (current.view === 'studio' && current.assetId !== id) writeEntry('replace', hashFor('studio', id), current.marker);
  }, []);
  const openInStudio = useCallback(
    (id: string, steps?: PipelineStep[]) => {
      if (steps) setPipelines((prev) => ({ ...prev, [id]: steps }));
      navigate('studio', id); // applies the studio asset and closes the Inspector
    },
    [navigate],
  );

  const reportFor = useCallback(
    (assetIds: string[], kind?: ReportKind) => {
      setReportScope({ ...DEFAULT_SCOPE, assetIds });
      if (kind) setReportKind(kind);
      navigate('reports'); // closes the Inspector; Back returns to it
    },
    [navigate],
  );

  // ---- context values -------------------------------------------------------

  const settingsOverridden = settingsOverride !== null;
  const data = useMemo<ConsoleData>(
    () => ({ now, assets, userAssets, getAsset, addUserAssets, removeUserAsset, settings, setSettings, resetSettings, settingsOverridden }),
    [now, assets, userAssets, getAsset, addUserAssets, removeUserAsset, settings, setSettings, resetSettings, settingsOverridden],
  );

  const routeValue = useMemo<ConsoleRoute>(
    () => ({
      route,
      navigate,
      studioAssetId: studioAsset.id,
      studioSteps,
      setStudioAsset,
      setStudioSteps,
      openInStudio,
      reportKind,
      setReportKind,
      reportScope,
      setReportScope,
      reportFor,
    }),
    [route, navigate, studioAsset.id, studioSteps, setStudioAsset, setStudioSteps, openInStudio, reportKind, reportScope, reportFor],
  );

  const ui = useMemo<ConsoleUi>(
    () => ({
      inspectId,
      inspect,
      closeInspector,
      paletteOpen,
      setPaletteOpen,
      ingestOpen,
      setIngestOpen,
      settingsOpen,
      setSettingsOpen,
      exportOpen,
      setExportOpen,
    }),
    [inspectId, inspect, closeInspector, paletteOpen, ingestOpen, settingsOpen, exportOpen],
  );

  const actions = useMemo<ConsoleActions>(
    () => ({
      navigate,
      openInStudio,
      reportFor,
      setStudioAsset,
      setReportKind,
      setReportScope,
      inspect,
      closeInspector,
      setPaletteOpen,
      setIngestOpen,
      setSettingsOpen,
      setExportOpen,
      addUserAssets,
      removeUserAsset,
      setSettings,
      resetSettings,
    }),
    [navigate, openInStudio, reportFor, setStudioAsset, inspect, closeInspector, addUserAssets, removeUserAsset, setSettings, resetSettings],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <DataContext.Provider value={data}>
        <RouteContext.Provider value={routeValue}>
          <UiContext.Provider value={ui}>{children}</UiContext.Provider>
        </RouteContext.Provider>
      </DataContext.Provider>
    </ActionsContext.Provider>
  );
}
