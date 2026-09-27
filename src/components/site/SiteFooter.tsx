'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/brand/Logo';
import { measure } from '@/lib/cloudinary/probe';
import { APP_VERSION } from '@/lib/version';
import { cn } from '@/components/ui/cn';

const STATUS_URL = 'https://res.cloudinary.com/demo/image/upload/c_fill,h_24,w_24/q_auto/f_auto/docs-obj-ai/zddpq7js2e8rdex0q4ka';

const COLUMNS: Array<{ title: string; links: Array<{ label: string; href: string; external?: boolean }> }> = [
  {
    title: 'Platform',
    links: [
      { label: 'Command Center', href: '/console#overview' },
      { label: 'Media Library', href: '/console#library' },
      { label: 'Incident Intelligence', href: '/console#incidents' },
      { label: 'Pipeline Studio', href: '/console#studio' },
      { label: 'Reports', href: '/console#reports' },
    ],
  },
  {
    title: 'Product',
    links: [
      { label: 'How it works', href: '/#platform' },
      { label: 'Solutions', href: '/#solutions' },
      { label: 'Intelligence', href: '/#intelligence' },
      { label: 'Evidence integrity', href: '/#evidence' },
    ],
  },
  {
    title: 'Technology',
    links: [
      { label: 'Cloudinary pipeline', href: '/#technology' },
      { label: 'Cloudinary docs', href: 'https://cloudinary.com/documentation', external: true },
      { label: 'next-cloudinary', href: 'https://next.cloudinary.dev', external: true },
    ],
  },
  {
    title: 'Resources',
    links: [
      {
        label: 'GitHub',
        href: 'https://github.com/HackIndiaXYZ/pixels-to-products-cloudinary-ai-hackathon-2026-team-rocket',
        external: true,
      },
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
    ],
  },
];

/** Live system status: a real HEAD probe against Cloudinary's delivery network. */
function SystemStatus() {
  const [state, setState] = useState<{ ok: boolean; ms?: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    measure(STATUS_URL, { accept: 'image/avif,image/webp,*/*' }).then((r) => {
      if (cancelled) return;
      setState(r.kind === 'ready' ? { ok: true, ms: Math.round(r.metrics.elapsedMs) } : { ok: false });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          state === null ? 'bg-ink-3' : state.ok ? 'bg-ok animate-pulse-dot' : 'bg-critical',
        )}
      />
      {state === null
        ? 'Checking Cloudinary delivery…'
        : state.ok
          ? `Cloudinary delivery operational · ${state.ms} ms`
          : 'Cloudinary delivery unreachable from this browser'}
    </span>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-canvas">
      <div className="mx-auto max-w-[1440px] px-5 pb-10 pt-16 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-4 text-[14px] leading-relaxed text-ink-2">
              Operational intelligence from the photos, footage and CCTV your teams already capture.
            </p>
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
              Built by Team Rocket for Pixels to Products — the Cloudinary AI Hackathon 2026, Track 1: AI Media Pipelines.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <h3 className="label">{col.title}</h3>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      {link.external ? (
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noreferrer"
                          className="link-underline text-[13px] text-ink-2 transition-colors hover:text-ink"
                        >
                          {link.label}
                          <ArrowUpRight aria-hidden className="ml-1 inline h-3 w-3 align-[-1px] opacity-60" />
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      ) : (
                        <Link href={link.href} className="link-underline text-[13px] text-ink-2 transition-colors hover:text-ink">
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6 font-mono text-[11px] text-ink-3">
          <span>© 2026 VisualOps · Team Rocket · v{APP_VERSION}</span>
          <SystemStatus />
        </div>
      </div>
    </footer>
  );
}
