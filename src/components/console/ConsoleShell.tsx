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
import { useEffect } from 'react';
import { canUpload, DEMO_CLOUD } from '@/lib/cloudinary/config';
import { findingRecords } from '@/lib/analytics';
import { Logo } from '@/components/brand/Logo';
import { Kbd, LiveDot } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { useConsole, type View } from './store';
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

export function ConsoleShell() {
  const { route, navigate, assets, settings, setPaletteOpen, paletteOpen, setIngestOpen, setSettingsOpen, userAssets } = useConsole();
  const openCount = findingRecords(assets).filter((r) => r.finding.status === 'open').length;
  const uploadsOn = canUpload(settings);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(!paletteOpen);
      } else if (!typing && event.key === '/' && !paletteOpen) {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, setPaletteOpen]);

  const current = NAV.find((n) => n.view === route.view) ?? NAV[0];

  return (
    <div className="min-h-screen bg-canvas pb-16 lg:pb-0">
      {/* Top bar */}
      <header className="sticky top-0 z-40 flex h-[52px] items-center gap-3 border-b border-line bg-canvas/90 px-3 backdrop-blur-md sm:px-4">
        <Link href="/" className="flex items-center rounded-md px-1.5 py-1 hover:bg-raised" aria-label="VisualOps home">
          <Logo />
        </Link>
        <span className="hidden text-line-strong sm:inline">/</span>
        <span className="hidden text-[13px] font-medium text-ink-2 sm:inline">{current.label}</span>

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="mx-auto flex h-8 w-full max-w-[420px] items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 text-left text-[13px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Ask anything about your visual data…</span>
          <span className="ml-auto hidden items-center gap-1 sm:flex">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="hidden items-center gap-2 rounded-[8px] border border-line px-2.5 py-1.5 font-mono text-[11px] text-ink-2 transition-colors hover:border-line-strong md:flex"
          title="Cloudinary configuration"
        >
          <LiveDot />
          <span>cloud: {settings.cloudName}</span>
          <span className="text-ink-3">{settings.cloudName === DEMO_CLOUD ? '· demo' : uploadsOn ? '· ingest on' : '· read-only'}</span>
        </button>
        <button type="button" onClick={() => setIngestOpen(true)} className="btn btn-primary btn-sm">
          <CloudUpload className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Ingest</span>
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="btn btn-ghost btn-sm btn-icon md:hidden"
          aria-label="Cloudinary settings"
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="sticky top-[52px] hidden h-[calc(100vh-52px)] w-[220px] shrink-0 flex-col border-r border-line px-2.5 py-3 lg:flex">
          <nav className="space-y-0.5" aria-label="Console">
            {NAV.map((item) => {
              const active = item.view === route.view;
              const Icon = item.icon;
              return (
                <button
                  key={item.view}
                  type="button"
                  onClick={() => navigate(item.view)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] transition-colors',
                    active ? 'text-ink' : 'text-ink-2 hover:bg-surface hover:text-ink',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="console-nav"
                      className="absolute inset-0 rounded-[8px] border border-line bg-raised"
                      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                    />
                  )}
                  <Icon className={cn('relative h-4 w-4', active ? 'text-signal' : 'text-ink-3')} />
                  <span className="relative font-medium">{item.label}</span>
                  {item.view === 'incidents' && openCount > 0 && (
                    <span className="num relative ml-auto rounded-[5px] bg-overlay px-1.5 font-mono text-[10.5px] text-ink-2">{openCount}</span>
                  )}
                  {item.view === 'library' && userAssets.length > 0 && (
                    <span className="num relative ml-auto rounded-[5px] bg-signal px-1.5 font-mono text-[10.5px] text-signal-ink">
                      +{userAssets.length}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="mt-auto space-y-3 border-t border-line px-1.5 pt-3">
            <div>
              <div className="label">Dataset</div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
                15 real field captures hosted on Cloudinary’s <span className="font-mono text-ink-2">demo</span> cloud. Findings are sample annotations.
              </p>
            </div>
            <Link href="/" className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">
              Product story <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1">
          {/* Transform-only entrance: content is never hidden behind an animation, and switching views never waits on an exit. */}
          <motion.div
            key={route.view}
            initial={{ y: 10 }}
            animate={{ y: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7"
          >
            {route.view === 'overview' && <OverviewView />}
            {route.view === 'library' && <LibraryView />}
            {route.view === 'incidents' && <IncidentsView />}
            {route.view === 'studio' && <StudioView />}
            {route.view === 'reports' && <ReportsView />}
          </motion.div>
        </main>
      </div>

      {/* Mobile tab bar */}
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
              onClick={() => navigate(item.view)}
              aria-current={active ? 'page' : undefined}
              className={cn('flex flex-col items-center gap-1 py-2 text-[10.5px]', active ? 'text-ink' : 'text-ink-3')}
            >
              <Icon className={cn('h-[18px] w-[18px]', active && 'text-signal')} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <Inspector />
      <AskPalette />
      <IngestSheet />
      <SettingsDialog />
    </div>
  );
}
