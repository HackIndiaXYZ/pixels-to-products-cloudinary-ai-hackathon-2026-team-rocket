'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  ArrowUpRight,
  CloudUpload,
  FileText,
  Images,
  LayoutDashboard,
  Search,
  Settings2,
  Siren,
  Wand2,
} from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, ViewTransition, type ComponentType, type MouseEvent } from 'react';
import { canUpload, DEMO_CLOUD } from '@/lib/cloudinary/config';
import { fieldAssets, findingRecords, isOpen } from '@/lib/analytics';
import { Logo } from '@/components/brand/Logo';
import { Kbd, LiveDot } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { useModKey } from '@/components/ui/useModKey';
import { useConsoleActions, useConsoleData, useConsoleRoute, useConsoleUi, type View } from './store';
import { OverviewView } from './views/OverviewView';
import { LibraryView } from './views/LibraryView';
import { IncidentsView } from './views/IncidentsView';
import { StudioView } from './views/StudioView';
import { ReportsView } from './views/ReportsView';
import { Inspector } from './Inspector';
import { AskPalette } from './AskPalette';
import { IngestSheet } from './IngestSheet';
import { SettingsDialog } from './SettingsDialog';

const NAV: Array<{ view: View; label: string; icon: typeof LayoutDashboard; hint: string }> = [
  { view: 'overview', label: 'Overview', icon: LayoutDashboard, hint: 'What needs attention' },
  { view: 'library', label: 'Library', icon: Images, hint: 'All field media' },
  { view: 'incidents', label: 'Incidents', icon: Siren, hint: 'Findings by risk' },
  { view: 'studio', label: 'Studio', icon: Wand2, hint: 'AI media pipeline' },
  { view: 'reports', label: 'Reports', icon: FileText, hint: 'Evidence packages' },
];

// The views take no props, so memo() lets them skip every shell re-render; each
// re-renders only for the console state it reads itself.
const VIEW_COMPONENTS: Record<View, ComponentType> = {
  overview: memo(OverviewView),
  library: memo(LibraryView),
  incidents: memo(IncidentsView),
  studio: memo(StudioView),
  reports: memo(ReportsView),
};

/** Focus target after a view switch: the new view's heading (every view renders one h1, focusable with tabIndex -1). */
function focusViewHeading() {
  const heading = document.querySelector<HTMLElement>('#content h1');
  if (!heading) return;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
}

/**
 * Each view gets its own document title, so history, tabs and screen readers can
 * tell them apart. Next.js streams the page's metadata <title> in and may commit
 * it after this effect, so the title is re-asserted whenever <head> changes —
 * but only while the console is still in the document (not after navigating away).
 */
function useViewTitle(title: string) {
  useEffect(() => {
    const apply = () => {
      if (document.getElementById('content')?.dataset.console === undefined) return;
      if (document.title !== title) document.title = title;
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [title]);
}

/** Skip link: moves focus into the view without touching the URL hash, which is the console's route. */
function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
  const main = document.getElementById('content');
  if (!main) return;
  event.preventDefault();
  main.focus({ preventScroll: true });
}

/**
 * The console frame: top bar, sidebar (desktop) or tab bar (phones), and the
 * current view. It reads only the route, the dataset and stable actions, so
 * opening Ask, the Inspector or a dialog never re-renders it.
 */
export function ConsoleShell() {
  const { route } = useConsoleRoute();
  const { assets, settings, backend, workspace, workspaceSettled } = useConsoleData();
  const ready = useWorkspaceReady(workspaceSettled);
  const { navigate, setPaletteOpen, setIngestOpen, setSettingsOpen } = useConsoleActions();
  const mod = useModKey();

  const openCount = useMemo(() => findingRecords(assets).filter(isOpen).length, [assets]);
  const sampleCount = useMemo(() => fieldAssets(assets.filter((a) => a.source === 'sample')).length, [assets]);
  // Records beyond the sample dataset: uploads and syncs in this browser plus records read from the team's cloud.
  const ownCount = useMemo(() => assets.filter((a) => a.source !== 'sample').length, [assets]);
  const uploadsOn = Boolean(backend?.configured) || canUpload(settings);
  // Until the server has answered, don't claim a cloud: the build-time default would read "demo" for a second.
  const cloudName = backend === null ? '…' : backend.configured && backend.cloudName ? backend.cloudName : settings.cloudName;
  const isDemo = cloudName === DEMO_CLOUD;

  const current = NAV.find((n) => n.view === route.view) ?? NAV[0];
  const CurrentView = VIEW_COMPONENTS[current.view];

  useViewTitle(`${current.label} · VisualOps`);

  // After a sidebar/tab-bar switch, focus lands on the new view's heading once it has committed.
  const focusPending = useRef(false);
  useLayoutEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    focusViewHeading();
  }, [route.view]);

  const go = (view: View) => {
    if (view === route.view) {
      navigate(view); // back to the top of the same view
      focusViewHeading();
      return;
    }
    focusPending.current = true;
    navigate(view);
  };

  return (
    // overflow-x-clip (not hidden): a safety net against any sideways overflow that creates no scroll container,
    // so the sticky header and sidebar keep working. Fixed overlays are unaffected.
    <div className="min-h-screen overflow-x-clip bg-canvas pb-16 lg:pb-0">
      <a
        href="#content"
        onClick={skipToContent}
        className="btn btn-secondary btn-sm fixed left-3 top-2 z-[60] -translate-y-[200%] focus:translate-y-0"
      >
        Skip to content
      </a>
      <PaletteHotkeys />

      {/* Top bar — paired with the landing preview's top bar, so entering the console morphs it into place. */}
      <ViewTransition name="console-topbar" share="morph" default="none">
        <header className="sticky top-0 z-40 flex h-[52px] items-center gap-2 border-b border-line bg-canvas/90 px-3 backdrop-blur-md sm:gap-3 sm:px-4">
          <Link href="/" className="flex shrink-0 items-center rounded-md px-1.5 py-1 hover:bg-raised" aria-label="VisualOps home">
            <Logo />
          </Link>
          <span aria-hidden className="hidden shrink-0 text-line-strong sm:inline">
            /
          </span>
          <span className="hidden shrink-0 text-[13px] font-medium text-ink-2 sm:inline">{current.label}</span>

          {/* min-w-0 + flex-1: the one item that yields, so the header never outgrows a phone. */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-keyshortcuts="Meta+K Control+K /"
            className="mx-auto flex h-8 min-w-0 max-w-[420px] flex-1 items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 text-left text-[13px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              <span className="sm:hidden">Ask VisualOps…</span>
              <span className="hidden sm:inline">Ask anything about your visual data…</span>
            </span>
            <span aria-hidden className="ml-auto hidden shrink-0 items-center gap-1 sm:flex">
              <Kbd>{mod}</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="hidden shrink-0 items-center gap-2 whitespace-nowrap rounded-[8px] border border-line px-2.5 py-1.5 font-mono text-[11px] text-ink-2 transition-colors hover:border-line-strong md:flex"
            title={
              isDemo
                ? 'Cloudinary configuration · demo is Cloudinary’s public sample cloud (read-only)'
                : `Cloudinary configuration · ${uploadsOn ? 'ingest on' : 'read-only'}`
            }
          >
            <LiveDot />
            <span>cloud: {cloudName}</span>
            <span className="hidden text-ink-3 lg:inline">· {uploadsOn ? 'ingest on' : 'read-only'}</span>
          </button>
          <button
            type="button"
            onClick={() => setIngestOpen(true)}
            className="btn btn-primary btn-sm shrink-0"
            aria-label="Ingest media"
          >
            <CloudUpload className="h-3.5 w-3.5" />
            <span aria-hidden className="hidden sm:inline">
              Ingest
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="btn btn-ghost btn-sm btn-icon shrink-0 md:hidden"
            aria-label="Cloudinary settings"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </header>
      </ViewTransition>

      <div className="flex">
        {/* Sidebar */}
        <ViewTransition name="console-sidebar" share="morph" default="none">
          <aside className="sticky top-[52px] hidden h-[calc(100vh-52px)] w-[220px] shrink-0 flex-col border-r border-line px-2.5 py-3 lg:flex">
            <nav className="space-y-0.5" aria-label="Console">
              {NAV.map((item) => {
                const active = item.view === route.view;
                const Icon = item.icon;
                return (
                  <button
                    key={item.view}
                    type="button"
                    onClick={() => go(item.view)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'relative flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] transition-colors',
                      active ? 'text-ink' : 'text-ink-2 hover:bg-surface hover:text-ink',
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="console-nav"
                        layoutDependency={route.view}
                        className="absolute inset-0 rounded-[8px] border border-line bg-raised"
                        transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                      />
                    )}
                    <Icon className={cn('relative h-4 w-4', active ? 'text-signal' : 'text-ink-3')} />
                    <span className="relative font-medium">{item.label}</span>
                    {item.view === 'incidents' && ready && openCount > 0 && (
                      <span className="num relative ml-auto rounded-[5px] bg-overlay px-1.5 font-mono text-[10.5px] text-ink-2">
                        <span className="sr-only">, </span>
                        {openCount}
                        <span className="sr-only"> open</span>
                      </span>
                    )}
                    {item.view === 'library' && ready && ownCount > 0 && (
                      <span className="num relative ml-auto rounded-[5px] bg-signal px-1.5 font-mono text-[10.5px] text-signal-ink">
                        <span className="sr-only">, </span>+{ownCount}
                        <span className="sr-only"> of your own records beyond the sample dataset</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            <div className="mt-auto space-y-3 border-t border-line px-1.5 pt-3">
              <div>
                <div className="label">Dataset</div>
                {!ready ? (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">Reading the workspace from Cloudinary…</p>
                ) : workspace === 'cloud' ? (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
                    {assets.length} records stored in your Cloudinary cloud <span className="font-mono text-ink-2">{cloudName}</span>, read with the
                    Search API. Sample-workspace findings are team annotations; captions and objects are Cloudinary AI.
                  </p>
                ) : (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
                    {sampleCount} sample field captures hosted on Cloudinary’s <span className="font-mono text-ink-2">{DEMO_CLOUD}</span> cloud.
                    Findings are sample annotations, and capture times are set relative to now.
                  </p>
                )}
              </div>
              <Link href="/" className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">
                Product story <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          </aside>
        </ViewTransition>

        {/* Main — shares its identity with the landing page's product preview, so entering the console morphs it into place. */}
        <ViewTransition name="product-frame" share="morph" default="none">
          <main id="content" tabIndex={-1} data-console="" className="min-w-0 flex-1 outline-none">
            {/* Transform-only entrance: content is never hidden behind an animation, and switching views never waits on an exit. */}
            <motion.div
              key={route.view}
              initial={{ y: 10 }}
              animate={{ y: 0 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7"
            >
              {ready ? <CurrentView /> : <WorkspaceLoading />}
            </motion.div>
          </main>
        </ViewTransition>
      </div>

      {/* Mobile tab bar — paired with the landing preview's tab bar on phones. */}
      <ViewTransition name="console-tabbar" share="morph" default="none">
        <nav
          aria-label="Console"
          className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-canvas/95 backdrop-blur-md lg:hidden"
        >
          {NAV.map((item) => {
            const active = item.view === route.view;
            const Icon = item.icon;
            return (
              <button
                key={item.view}
                type="button"
                onClick={() => go(item.view)}
                aria-current={active ? 'page' : undefined}
                className={cn('flex min-w-0 flex-col items-center gap-1 py-2 text-[10.5px]', active ? 'text-ink' : 'text-ink-3')}
              >
                <Icon className={cn('h-[18px] w-[18px]', active && 'text-signal')} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </ViewTransition>

      {ready && <Inspector />}
      <AskPalette />
      <IngestSheet />
      <SettingsDialog />
    </div>
  );
}

/** Longest the console waits for the workspace before showing what it has. */
const SETTLE_TIMEOUT_MS = 8000;

/**
 * True once the workspace is known: the server answered and, when it is connected, the team's records were
 * read. Until then the views wait, so a connected console never shows the bundled samples for a moment
 * before swapping in the team's cloud. A slow or stuck read gives up waiting after SETTLE_TIMEOUT_MS.
 */
function useWorkspaceReady(settled: boolean): boolean {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (settled) return;
    const timer = window.setTimeout(() => setExpired(true), SETTLE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [settled]);
  return settled || expired;
}

/** Placeholder for the current view while the workspace is read, shaped like the console's own skeleton. */
function WorkspaceLoading() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Reading the workspace from Cloudinary…</span>
      <div aria-hidden className="h-6 w-48 animate-pulse rounded bg-raised" />
      <div aria-hidden className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-[12px] bg-surface" />
        ))}
      </div>
      <div aria-hidden className="mt-3 h-72 animate-pulse rounded-[12px] bg-surface" />
    </div>
  );
}

/**
 * ⌘K / Ctrl+K toggles Ask; "/" opens it when not typing. Lives in its own
 * component so that only this (render-free) node follows the palette's state —
 * the shell itself never re-renders when an overlay opens or closes.
 */
function PaletteHotkeys() {
  const { paletteOpen, setPaletteOpen } = useConsoleUi();
  const openRef = useRef(paletteOpen);
  useEffect(() => {
    openRef.current = paletteOpen;
  }, [paletteOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (!typing && !event.defaultPrevented && event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !openRef.current) {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPaletteOpen]);

  return null;
}
