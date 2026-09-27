'use client';

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
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
import { DEMO_CLOUD, ENV_SETTINGS } from '@/lib/cloudinary/config';
import { fetchBackendConfig, fetchCloudAssets, type BackendConfig, type CloudResource } from '@/lib/cloudinary/backend';
import { cloudResourceToAsset } from '@/lib/cloudinary/upload';
import { defaultPresetFor, presetSteps, type PipelineStep } from '@/lib/cloudinary/pipeline';
import { DEFAULT_SCOPE, type ReportKind, type ReportScope } from '@/lib/report';
import { hashFor, parseHash, readEntry, rememberScroll, writeEntry, type HistoryEntry, type View } from './state/history';
import { MAX_STORED_ASSETS, parseStoredAssets, parseStoredSettings } from './state/persisted';

export { VIEWS, type View } from './state/history';

/** The view on screen. The Inspector's record is not part of it, so opening a record never re-renders the views. */
export interface Route {
  view: View;
}

const USER_ASSETS_KEY = 'visualops.userAssets.v1';
const SETTINGS_KEY = 'visualops.settings.v1';
const DEFAULT_STUDIO_ASSET = 'vo-road-collapse';
/**
 * `npm run seed:cloudinary` imports each bundled sample into the team's cloud as `visualops/<sample id>`,
 * so a sample id (a default, a bookmarked #studio/vo-… link) can resolve to its seeded cloud record.
 */
const SEED_PREFIX = 'visualops/';
/** A record removed from the workspace stays hidden this long, while the Search index catches up. */
const TOMBSTONE_MS = 5 * 60 * 1000;

/** Reads and parses a stored JSON value. The result is untrusted: validate it before use. */
function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

/** One record per Cloudinary asset. */
const assetKey = (a: Pick<MediaAsset, 'cloudName' | 'resourceType' | 'publicId'>) => `${a.cloudName}/${a.resourceType}/${a.publicId}`;

/** True when `current` carries a newer Cloudinary AI analysis than `fetched` (the Search index lags writes). */
function newerAnalysis(current: MediaAsset, fetched: MediaAsset): boolean {
  const mine = Date.parse(current.ai?.analyzedAt ?? '');
  if (!Number.isFinite(mine)) return false;
  const theirs = Date.parse(fetched.ai?.analyzedAt ?? '');
  return !Number.isFinite(theirs) || mine > theirs;
}

/**
 * Maps Search results to records (sample times materialised against the console's clock, the collection tag
 * kept off the record's tags); a resource the mapper can't read is skipped rather than failing the whole read.
 */
function toRecords(page: { cloudName: string; tag: string; resources: CloudResource[] }, now: number): MediaAsset[] {
  const out: MediaAsset[] = [];
  for (const r of page.resources) {
    try {
      out.push(cloudResourceToAsset(page.cloudName, r, { tag: page.tag, now }));
    } catch {
      /* malformed resource: leave it out */
    }
  }
  return out;
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode, quota) — the session still works */
  }
}

// ---- context shapes -------------------------------------------------------

/**
 * Which records the console works on.
 * - `cloud`: the server is connected to Cloudinary and the team's cloud holds at least one VisualOps record.
 *   The console shows only the cloud's records (plus uploads from this browser that the Search index has not
 *   returned yet); the bundled samples are hidden.
 * - `sample`: the bundled sample workspace on Cloudinary's demo cloud, plus this browser's uploads and syncs.
 */
export type Workspace = 'cloud' | 'sample';

/** Dataset and Cloudinary settings. Changes when assets are added/removed or settings are saved. */
export interface ConsoleData {
  now: number;
  /** The records of the current workspace. */
  assets: MediaAsset[];
  /** This browser's uploads and syncs (localStorage), in every workspace. */
  userAssets: MediaAsset[];
  /** A record of the current workspace. In the cloud workspace a sample id also finds its seeded copy. */
  getAsset: (id: string | undefined | null) => MediaAsset | undefined;
  addUserAssets: (assets: MediaAsset[]) => void;
  removeUserAsset: (id: string) => void;
  settings: CloudSettings;
  setSettings: (settings: CloudSettings) => void;
  resetSettings: () => void;
  settingsOverridden: boolean;
  /** The VisualOps server's Cloudinary connection (null while it is being checked). */
  backend: BackendConfig | null;
  /** Records loaded from the team's Cloudinary cloud through GET /api/assets. */
  cloud: CloudState;
  /** Re-reads the team's records from Cloudinary; resolves to how many there are. */
  refreshCloud: () => Promise<number>;
  /** See {@link Workspace}. */
  workspace: Workspace;
  /**
   * False while the server connection or the first read of the cloud is still pending, i.e. while the
   * console may yet switch from the sample workspace to the cloud workspace.
   */
  workspaceSettled: boolean;
  /** Replaces a cloud record in place (e.g. after POST /api/assets/[id]/analyze wrote its AI understanding). */
  updateCloudAsset: (asset: MediaAsset) => void;
  /** Drops a record from the workspace (e.g. after DELETE /api/assets/[id] removed its VisualOps tag). */
  removeCloudAsset: (id: string) => void;
}

export type CloudState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'ready'; count: number; at: number }
  | { status: 'error'; message: string };

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
  updateCloudAsset: ConsoleData['updateCloudAsset'];
  removeCloudAsset: ConsoleData['removeCloudAsset'];
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
  // Stored values are validated entry by entry; invalid ones are dropped (and gone from storage on the next write).
  const [userAssets, setUserAssets] = useState<MediaAsset[]>(() => parseStoredAssets(readJson(USER_ASSETS_KEY)));
  const [settingsOverride, setSettingsOverride] = useState<CloudSettings | null>(() => parseStoredSettings(readJson(SETTINGS_KEY)));

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

  // The server's Cloudinary connection, and the team's records stored there (tags + context metadata).
  const [backend, setBackend] = useState<BackendConfig | null>(null);
  const [cloudAssets, setCloudAssets] = useState<MediaAsset[]>([]);
  const [cloud, setCloud] = useState<CloudState>({ status: 'off' });

  // Latest lists for the stable callbacks below (mirrored after each commit; read only from event handlers).
  const cloudAssetsRef = useRef<MediaAsset[]>(cloudAssets);
  const userAssetsRef = useRef<MediaAsset[]>(userAssets);
  useEffect(() => {
    cloudAssetsRef.current = cloudAssets;
    userAssetsRef.current = userAssets;
  }, [cloudAssets, userAssets]);
  /** Records removed from the workspace in this session (asset key → when), hidden while Search catches up. */
  const tombstones = useRef(new Map<string, number>());
  /** Ids uploaded in this session: never pruned as "gone from the cloud" (the Search index may not have them yet). */
  const addedThisSession = useRef(new Set<string>());
  /** Only the latest refresh writes state, so an older response that arrives late can't overwrite a newer one. */
  const refreshSeq = useRef(0);

  const refreshCloud = useCallback(async () => {
    const seq = ++refreshSeq.current;
    setCloud({ status: 'loading' });
    try {
      const page = await fetchCloudAssets();
      const at = Date.now();
      for (const [key, removedAt] of tombstones.current) if (at - removedAt > TOMBSTONE_MS) tombstones.current.delete(key);
      const records = toRecords(page, now).filter((a) => !tombstones.current.has(assetKey(a)));
      if (seq !== refreshSeq.current) return records.length;

      // Keep an in-memory copy whose AI analysis is newer than the one the Search index returned.
      setCloudAssets((prev) => {
        const current = new Map(prev.map((a) => [a.id, a]));
        return records.map((r) => {
          const mine = current.get(r.id);
          return mine && newerAnalysis(mine, r) ? mine : r;
        });
      });

      // A complete read is authoritative for this cloud: an upload from an earlier session that is no longer in
      // it was removed from the workspace (or deleted) elsewhere, so its cached copy is dropped.
      if (!page.nextCursor) {
        const inCloud = new Set(records.map(assetKey));
        setUserAssets((prev) => {
          const next = prev.filter(
            (a) => !(a.source === 'upload' && a.cloudName === page.cloudName && !inCloud.has(assetKey(a)) && !addedThisSession.current.has(a.id)),
          );
          if (next.length === prev.length) return prev;
          writeJson(USER_ASSETS_KEY, next);
          return next;
        });
      }

      setCloud({ status: 'ready', count: records.length, at });
      return records.length;
    } catch (error) {
      if (seq === refreshSeq.current) setCloud({ status: 'error', message: (error as Error).message });
      throw error;
    }
  }, [now]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchBackendConfig(controller.signal).then((config) => {
      if (controller.signal.aborted) return;
      setBackend(config);
      if (config.configured) refreshCloud().catch(() => undefined);
    });
    return () => controller.abort();
  }, [refreshCloud]);

  // Cloud workspace: the server is connected and the team's cloud holds VisualOps records.
  const serverCloud = backend?.configured ? backend.cloudName : undefined;
  const workspace: Workspace = backend?.configured && cloudAssets.length > 0 ? 'cloud' : 'sample';
  const workspaceSettled =
    backend !== null && (!backend.configured || cloudAssets.length > 0 || cloud.status === 'ready' || cloud.status === 'error');

  // One record per Cloudinary asset: the copy read from the cloud wins over this browser's cached copy.
  const assets = useMemo(() => {
    const inCloud = new Set(cloudAssets.map(assetKey));
    if (workspace === 'cloud') {
      // Only the team's records: this browser's uploads to the same cloud that Search hasn't returned yet
      // (newest, so first), then the cloud's records. Samples, syncs and other clouds' uploads stay out.
      const pending = userAssets.filter((a) => a.source === 'upload' && a.cloudName === serverCloud && !inCloud.has(assetKey(a)));
      return [...pending, ...cloudAssets];
    }
    return [...cloudAssets, ...userAssets.filter((a) => !inCloud.has(assetKey(a))), ...samples];
  }, [workspace, serverCloud, cloudAssets, userAssets, samples]);

  const assetIndex = useMemo(() => {
    const byId = new Map<string, MediaAsset>();
    const bySeedId = new Map<string, MediaAsset>();
    for (const a of assets) {
      if (!byId.has(a.id)) byId.set(a.id, a);
      if (a.publicId.startsWith(SEED_PREFIX)) {
        const seedId = a.publicId.slice(SEED_PREFIX.length);
        if (!bySeedId.has(seedId)) bySeedId.set(seedId, a);
      }
    }
    return { byId, bySeedId };
  }, [assets]);
  const getAsset = useCallback(
    (id: string | undefined | null) => {
      if (!id) return undefined;
      // In the cloud workspace a bundled sample's id (a default, a bookmarked link) finds its seeded copy.
      return assetIndex.byId.get(id) ?? (workspace === 'cloud' ? assetIndex.bySeedId.get(id) : undefined);
    },
    [assetIndex, workspace],
  );

  const updateCloudAsset = useCallback((asset: MediaAsset) => {
    // Bundled samples (demo cloud) are not cloud records. Seeded records also carry source 'sample'
    // (provenance sample-annotation) but live in the team's cloud, so they are updated like any other.
    if (asset.source === 'sample' && asset.cloudName === DEMO_CLOUD) return;
    const key = assetKey(asset);
    const matches = (a: MediaAsset) => a.id === asset.id || assetKey(a) === key;
    tombstones.current.delete(key);
    setCloudAssets((prev) => {
      const i = prev.findIndex(matches);
      if (i >= 0) {
        const next = prev.slice();
        next[i] = asset;
        return next;
      }
      // Not read from the cloud yet: a pending upload is updated below; anything else was just written to the cloud.
      return userAssetsRef.current.some(matches) ? prev : [asset, ...prev];
    });
    setUserAssets((prev) => {
      const i = prev.findIndex(matches);
      if (i < 0) return prev;
      const next = prev.slice();
      next[i] = asset;
      writeJson(USER_ASSETS_KEY, next);
      return next;
    });
  }, []);

  const removeCloudAsset = useCallback((id: string) => {
    const target = cloudAssetsRef.current.find((a) => a.id === id) ?? userAssetsRef.current.find((a) => a.id === id);
    const key = target ? assetKey(target) : null;
    if (key) tombstones.current.set(key, Date.now());
    const matches = (a: MediaAsset) => a.id === id || (key !== null && assetKey(a) === key);
    setCloudAssets((prev) => (prev.some(matches) ? prev.filter((a) => !matches(a)) : prev));
    // The cached local copy goes too, so it can't come back as a "pending" upload.
    setUserAssets((prev) => {
      if (!prev.some(matches)) return prev;
      const next = prev.filter((a) => !matches(a));
      writeJson(USER_ASSETS_KEY, next);
      return next;
    });
  }, []);

  const addUserAssets = useCallback((incoming: MediaAsset[]) => {
    incoming.forEach((a) => {
      addedThisSession.current.add(a.id);
      tombstones.current.delete(assetKey(a));
    });
    setUserAssets((prev) => {
      const byId = new Map(prev.map((a) => [a.id, a]));
      incoming.forEach((a) => byId.set(a.id, a));
      const next = Array.from(byId.values())
        .sort((a, b) => +new Date(b.capturedAt) - +new Date(a.capturedAt))
        .slice(0, MAX_STORED_ASSETS);
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
    // Same rules as the stored value is read back with (the dialog validates first, so this never drops input).
    const valid = parseStoredSettings(next);
    if (!valid) return;
    setSettingsOverride(valid);
    writeJson(SETTINGS_KEY, valid);
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

  // The requested asset; else the default (in the cloud workspace, its seeded copy); else the first field record.
  const studioAsset = useMemo(
    () =>
      getAsset(studioAssetId) ??
      getAsset(DEFAULT_STUDIO_ASSET) ??
      assets.find((a) => a.collection !== 'reference') ??
      assets[0] ??
      samples[0],
    [getAsset, studioAssetId, assets, samples],
  );
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
  // The count follows local changes too (a record removed from the workspace, an analysed record added).
  const cloudCount = cloudAssets.length;
  const cloudState = useMemo<CloudState>(() => (cloud.status === 'ready' ? { ...cloud, count: cloudCount } : cloud), [cloud, cloudCount]);
  const data = useMemo<ConsoleData>(
    () => ({
      now,
      assets,
      userAssets,
      getAsset,
      addUserAssets,
      removeUserAsset,
      settings,
      setSettings,
      resetSettings,
      settingsOverridden,
      backend,
      cloud: cloudState,
      refreshCloud,
      workspace,
      workspaceSettled,
      updateCloudAsset,
      removeCloudAsset,
    }),
    [
      now,
      assets,
      userAssets,
      getAsset,
      addUserAssets,
      removeUserAsset,
      settings,
      setSettings,
      resetSettings,
      settingsOverridden,
      backend,
      cloudState,
      refreshCloud,
      workspace,
      workspaceSettled,
      updateCloudAsset,
      removeCloudAsset,
    ],
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
      updateCloudAsset,
      removeCloudAsset,
      setSettings,
      resetSettings,
    }),
    [
      navigate,
      openInStudio,
      reportFor,
      setStudioAsset,
      inspect,
      closeInspector,
      addUserAssets,
      removeUserAsset,
      updateCloudAsset,
      removeCloudAsset,
      setSettings,
      resetSettings,
    ],
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
