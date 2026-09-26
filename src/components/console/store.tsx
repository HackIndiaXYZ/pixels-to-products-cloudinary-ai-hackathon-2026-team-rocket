'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CloudSettings, MediaAsset } from '@/lib/types';
import { buildSampleAssets } from '@/lib/data/dataset';
import { ENV_SETTINGS } from '@/lib/cloudinary/config';
import { defaultPresetFor, presetSteps, type PipelineStep } from '@/lib/cloudinary/pipeline';
import { DEFAULT_SCOPE, type ReportKind, type ReportScope } from '@/lib/report';

export type View = 'overview' | 'library' | 'incidents' | 'studio' | 'reports';
export const VIEWS: View[] = ['overview', 'library', 'incidents', 'studio', 'reports'];

interface Route {
  view: View;
  assetId?: string;
}

const USER_ASSETS_KEY = 'visualops.userAssets.v1';
const SETTINGS_KEY = 'visualops.settings.v1';

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

function parseHash(hash: string): Route {
  const [view, ...rest] = hash.replace(/^#\/?/, '').split('/');
  const v = VIEWS.includes(view as View) ? (view as View) : 'overview';
  const assetId = rest.length ? decodeURIComponent(rest.join('/')) : undefined;
  return { view: v, assetId };
}

interface ConsoleContextValue {
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

  route: Route;
  navigate: (view: View, assetId?: string) => void;

  inspectId: string | null;
  inspect: (id: string | null) => void;

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

  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  ingestOpen: boolean;
  setIngestOpen: (open: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  exportOpen: boolean;
  setExportOpen: (open: boolean) => void;
}

const ConsoleContext = createContext<ConsoleContextValue | null>(null);

export function useConsole(): ConsoleContextValue {
  const ctx = useContext(ConsoleContext);
  if (!ctx) throw new Error('useConsole must be used inside <ConsoleProvider>');
  return ctx;
}

export function ConsoleProvider({ children }: { children: ReactNode }) {
  // Client-only provider (see ConsoleRoot): Date.now and localStorage are safe here.
  const [now] = useState(() => Date.now());
  const [samples] = useState(() => buildSampleAssets(now));
  const [userAssets, setUserAssets] = useState<MediaAsset[]>(() => readJson<MediaAsset[]>(USER_ASSETS_KEY, []));
  const [settingsOverride, setSettingsOverride] = useState<CloudSettings | null>(() =>
    readJson<CloudSettings | null>(SETTINGS_KEY, null),
  );
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [inspectId, setInspectId] = useState<string | null>(() => {
    const r = parseHash(window.location.hash);
    return r.view !== 'studio' && r.assetId ? r.assetId : null;
  });

  const assets = useMemo(() => [...userAssets, ...samples], [userAssets, samples]);
  const getAsset = useCallback((id: string | undefined | null) => (id ? assets.find((a) => a.id === id) : undefined), [assets]);

  const initialStudio = (() => {
    const r = parseHash(window.location.hash);
    return r.view === 'studio' && r.assetId ? r.assetId : 'vo-road-collapse';
  })();
  const [studioAssetId, setStudioAssetId] = useState<string>(initialStudio);
  const [pipelines, setPipelines] = useState<Record<string, PipelineStep[]>>({});

  const [reportKind, setReportKind] = useState<ReportKind>('inspection');
  const [reportScope, setReportScope] = useState<ReportScope>(DEFAULT_SCOPE);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    const onHash = () => {
      const next = parseHash(window.location.hash);
      setRoute(next);
      if (next.view === 'studio' && next.assetId) setStudioAssetId(next.assetId);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((view: View, assetId?: string) => {
    const hash = `#${view}${assetId ? `/${encodeURIComponent(assetId)}` : ''}`;
    if (window.location.hash !== hash) window.location.hash = hash;
    window.scrollTo({ top: 0 });
  }, []);

  const inspect = useCallback((id: string | null) => setInspectId(id), []);

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

  const studioAsset = getAsset(studioAssetId) ?? samples[0];
  const studioSteps = pipelines[studioAsset.id] ?? presetSteps(defaultPresetFor(studioAsset));
  const setStudioSteps = useCallback(
    (steps: PipelineStep[]) => setPipelines((prev) => ({ ...prev, [studioAsset.id]: steps })),
    [studioAsset.id],
  );
  const setStudioAsset = useCallback((id: string) => {
    setStudioAssetId(id);
    const hash = `#studio/${encodeURIComponent(id)}`;
    if (window.location.hash.startsWith('#studio') && window.location.hash !== hash) {
      window.history.replaceState(null, '', hash);
    }
  }, []);
  const openInStudio = useCallback(
    (id: string, steps?: PipelineStep[]) => {
      setStudioAssetId(id);
      if (steps) setPipelines((prev) => ({ ...prev, [id]: steps }));
      setInspectId(null);
      navigate('studio', id);
    },
    [navigate],
  );

  const reportFor = useCallback(
    (assetIds: string[], kind?: ReportKind) => {
      setReportScope({ ...DEFAULT_SCOPE, assetIds });
      if (kind) setReportKind(kind);
      navigate('reports');
    },
    [navigate],
  );

  const value: ConsoleContextValue = {
    now,
    assets,
    userAssets,
    getAsset,
    addUserAssets,
    removeUserAsset,
    settings,
    setSettings,
    resetSettings,
    settingsOverridden: settingsOverride !== null,
    route,
    navigate,
    inspectId,
    inspect,
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
    paletteOpen,
    setPaletteOpen,
    ingestOpen,
    setIngestOpen,
    settingsOpen,
    setSettingsOpen,
    exportOpen,
    setExportOpen,
  };

  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>;
}
