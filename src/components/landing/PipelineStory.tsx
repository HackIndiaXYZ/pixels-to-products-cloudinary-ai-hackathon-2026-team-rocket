'use client';

import { AnimatePresence, motion, useInView } from 'framer-motion';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_LABEL, SEVERITIES, fieldAssets, findingRecords, siteSummaries } from '@/lib/analytics';
import { rawStillUrl, redactedUrl, thumbUrl } from '@/lib/cloudinary/media';
import { fetchInsight, type CloudinaryInsight } from '@/lib/cloudinary/insights';
import { parseQuery, runQuery } from '@/lib/search/query';
import { evidenceStillUrl, sha256Hex } from '@/lib/report';
import { RegionLayer } from '@/components/media/RegionLayer';
import { SEVERITY_COLOR, SeverityBadge } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { LANDING_ASSETS, landingAsset } from './landing-data';

const STEPS = [
  {
    id: 'raw',
    title: 'Raw media',
    body: 'Photos from phones and chat groups, drone passes, CCTV exports. They arrive with a file name and nothing else — no site, no severity, no owner.',
    tech: 'Cloudinary stores and delivers every original · video frames extracted with so_',
  },
  {
    id: 'understand',
    title: 'Understand',
    body: 'Cloudinary’s AI finds the subject and the people in every frame. Faces are pixelated before anything is shared; soft captures get exposure and sharpening — nothing invented.',
    tech: 'g_auto · fl_getinfo · e_pixelate_faces · e_improve · e_sharpen',
  },
  {
    id: 'structure',
    title: 'Structure',
    body: 'Each capture becomes a record: site, zone, category, severity, status, observation and action. Uploads carry the same fields into Cloudinary as tags and context metadata.',
    tech: 'Upload API tags + context · resource list sync',
  },
  {
    id: 'search',
    title: 'Search',
    body: 'Ask in plain language. VisualOps turns the question into explicit filters and shows you exactly how it understood it.',
    tech: 'Transparent query parser over the structured index',
  },
  {
    id: 'insight',
    title: 'Insight',
    body: 'Where risk concentrates, what is still open, which site needs a visit today — computed from the records, not guessed.',
    tech: 'Aggregates by site, category, severity and time',
  },
  {
    id: 'action',
    title: 'Action',
    body: 'Evidence packages with Cloudinary-stamped, face-redacted frames, exported as PDF, Markdown, JSON or CSV with a SHA-256 fingerprint.',
    tech: 'l_text audit stamp · e_pixelate_faces · SHA-256 in the browser',
  },
] as const;

type StepId = (typeof STEPS)[number]['id'];

export function PipelineStory() {
  const [active, setActive] = useState<StepId>('raw');

  return (
    <section id="pipeline" className="relative border-b border-line">
      <div className="mx-auto max-w-[1320px] px-4 py-20 sm:px-6 lg:py-28">
        <div className="max-w-2xl">
          <p className="label">The pipeline</p>
          <h2 className="mt-4 text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[44px]">
            From a camera roll to a decision.
          </h2>
          <p className="mt-4 text-[16px] leading-relaxed text-ink-2">
            Six stages, one media layer. Everything on the right is rendered live by Cloudinary from the same sample dataset the console uses.
          </p>
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
          <ol className="space-y-6 lg:space-y-0">
            {STEPS.map((step, i) => (
              <StepText key={step.id} index={i} step={step} active={active === step.id} onActive={() => setActive(step.id)} />
            ))}
          </ol>
          <div className="hidden lg:block">
            <div className="sticky top-[14vh]">
              <div className="relative aspect-[4/3] overflow-hidden rounded-[14px] border border-line-strong bg-surface">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div
                    key={active}
                    initial={{ opacity: 0, scale: 0.985 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute inset-0"
                  >
                    <StepVisual id={active} />
                  </motion.div>
                </AnimatePresence>
              </div>
              <div className="mt-3 flex gap-1.5">
                {STEPS.map((s) => (
                  <span key={s.id} className={cn('h-0.5 flex-1 rounded-full transition-colors duration-300', s.id === active ? 'bg-signal' : 'bg-line-strong')} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StepText({
  index,
  step,
  active,
  onActive,
}: {
  index: number;
  step: (typeof STEPS)[number];
  active: boolean;
  onActive: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  const inView = useInView(ref, { margin: '-45% 0px -45% 0px' });
  useEffect(() => {
    if (inView) onActive();
  }, [inView, onActive]);

  return (
    <li ref={ref} className="lg:flex lg:min-h-[62vh] lg:items-center">
      <div className={cn('transition-opacity duration-300 lg:max-w-md', active ? 'lg:opacity-100' : 'lg:opacity-35')}>
        <div className="flex items-center gap-3">
          <span className="num font-mono text-[12px] text-signal">{String(index + 1).padStart(2, '0')}</span>
          <span className="h-px w-8 bg-line-strong" />
          <span className="label">{step.tech}</span>
        </div>
        <h3 className="mt-4 text-[26px] font-semibold tracking-[-0.03em]">{step.title}</h3>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{step.body}</p>
        {/* Visual inline on small screens */}
        <div className="mt-6 aspect-[4/3] overflow-hidden rounded-[12px] border border-line-strong bg-surface lg:hidden">
          <StepVisual id={step.id} />
        </div>
      </div>
    </li>
  );
}

function StepVisual({ id }: { id: StepId }) {
  switch (id) {
    case 'raw':
      return <RawVisual />;
    case 'understand':
      return <UnderstandVisual />;
    case 'structure':
      return <StructureVisual />;
    case 'search':
      return <SearchVisual />;
    case 'insight':
      return <InsightVisual />;
    case 'action':
      return <ActionVisual />;
  }
}

const PILE = ['vo-road-collapse', 'vo-demolition-deck', 'vo-wet-floor', 'vo-receiving-label', 'vo-fleet-dash', 'vo-bridge-truss'];

function RawVisual() {
  const rotations = [-4, 3, -2, 5, -3, 2];
  return (
    <div className="relative h-full w-full p-8">
      <div className="grid h-full grid-cols-3 gap-4">
        {PILE.map((id, i) => {
          const a = landingAsset(id);
          return (
            <div key={id} className="flex flex-col" style={{ transform: `rotate(${rotations[i]}deg)` }}>
              <div className="relative flex-1 overflow-hidden rounded-[6px] border border-line-strong bg-raised">
                {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
                <img src={thumbUrl(a, 360, 280)} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
              </div>
              <span className="mt-1.5 truncate font-mono text-[10.5px] text-ink-3">{a.fileName}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UnderstandVisual() {
  const asset = landingAsset('vo-crew-ppe');
  const [insight, setInsight] = useState<CloudinaryInsight | null>(null);
  const [redacted, setRedacted] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchInsight(asset).then((i) => !cancelled && setInsight(i)).catch(() => undefined);
    const t = setTimeout(() => !cancelled && setRedacted(true), 1800);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [asset]);
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: `${asset.width} / ${asset.height}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
        <img src={redacted ? redactedUrl(asset, 1200) : rawStillUrl(asset, 1200)} alt="Crew at a scaffold tower" className="absolute inset-0 h-full w-full object-cover" />
        {!redacted && insight && <RegionLayer regions={insight.faces} variant="face" />}
        {insight?.focus && <RegionLayer regions={[{ ...insight.focus, label: 'SUBJECT · g_auto' }]} variant="focus" />}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 font-mono text-[11px] text-ink-2">
        <span>
          {insight ? `${insight.faces.length} faces detected by Cloudinary` : 'Asking Cloudinary…'} · {redacted ? 'e_pixelate_faces applied' : 'redacting…'}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRedacted((v) => !v)}>
          {redacted ? 'Show faces' : 'Redact'}
        </button>
      </div>
    </div>
  );
}

function StructureVisual() {
  const asset = landingAsset('vo-road-collapse');
  const f = asset.finding!;
  const rows: Array<[string, string]> = [
    ['file', asset.fileName],
    ['site', `${asset.site} · ${asset.zone}`],
    ['category', CATEGORY_LABEL[f.category].toLowerCase()],
    ['severity', f.severity],
    ['status', f.status],
    ['cloudinary', `${asset.cloudName}/${asset.publicId}`],
    ['tags', asset.tags.slice(0, 5).join(', ')],
  ];
  return (
    <div className="grid h-full grid-cols-[0.9fr_1.1fr]">
      <div className="relative border-r border-line">
        {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
        <img src={thumbUrl(asset, 600, 760)} alt="" className="absolute inset-0 h-full w-full object-cover" />
      </div>
      <div className="flex flex-col justify-center gap-4 p-6">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] text-ink-3">{f.id}</span>
          <SeverityBadge severity={f.severity} />
        </div>
        <div className="text-[18px] font-semibold leading-snug tracking-[-0.015em]">{f.title}</div>
        <dl className="space-y-1.5 font-mono text-[11.5px]">
          {rows.map(([k, v], i) => (
            <motion.div
              key={k}
              initial={{ x: -6 }}
              animate={{ x: 0 }}
              transition={{ delay: 0.05 * i, duration: 0.3 }}
              className="grid grid-cols-[84px_1fr] gap-2"
            >
              <dt className="text-ink-3">{k}</dt>
              <dd className="truncate text-ink">{v}</dd>
            </motion.div>
          ))}
        </dl>
      </div>
    </div>
  );
}

const DEMO_QUERY = 'Show high severity issues from Building B';

function SearchVisual() {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTyped(DEMO_QUERY.slice(0, i));
      if (i >= DEMO_QUERY.length) clearInterval(id);
    }, 38);
    return () => clearInterval(id);
  }, []);
  const complete = typed.length === DEMO_QUERY.length;
  const sites = useMemo(() => Array.from(new Set(LANDING_ASSETS.map((a) => a.site))), []);
  const parsed = useMemo(() => parseQuery(DEMO_QUERY, sites, Date.UTC(2026, 8, 26, 9)), [sites]);
  const hits = useMemo(() => runQuery(parsed, fieldAssets(LANDING_ASSETS)).hits, [parsed]);
  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-center gap-3 rounded-[10px] border border-line-strong bg-canvas px-3.5 py-3">
        <Search className="h-4 w-4 text-signal" />
        <span className="text-[15px]">
          {typed}
          <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-pulse-dot bg-ink" />
        </span>
      </div>
      <div className={cn('flex flex-wrap items-center gap-1.5 transition-opacity', complete ? 'opacity-100' : 'opacity-30')}>
        <span className="label mr-1">Understood as</span>
        {parsed.severities.map((s) => (
          <span key={s} className="chip text-signal">severity: {s}</span>
        ))}
        {parsed.sites.map((s) => (
          <span key={s} className="chip text-signal">site: {s}</span>
        ))}
      </div>
      <div className="flex-1 space-y-2">
        {complete &&
          hits.map((h, i) => (
            <motion.div
              key={h.asset.id}
              initial={{ y: 8 }}
              animate={{ y: 0 }}
              transition={{ delay: 0.08 * i }}
              className="flex items-center gap-3 rounded-[10px] border border-line bg-raised p-2.5"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
              <img src={thumbUrl(h.asset, 160, 100)} alt="" className="h-[50px] w-[80px] rounded-[6px] object-cover" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {h.asset.finding && <SeverityBadge severity={h.asset.finding.severity} />}
                  <span className="font-mono text-[11px] text-ink-3">{h.asset.fileName}</span>
                </div>
                <div className="mt-1 truncate text-[13.5px] font-medium">{h.asset.finding?.title}</div>
              </div>
            </motion.div>
          ))}
      </div>
    </div>
  );
}

function InsightVisual() {
  const records = findingRecords(LANDING_ASSETS);
  const sites = siteSummaries(records);
  const max = Math.max(1, ...sites.map((s) => s.total));
  return (
    <div className="flex h-full flex-col justify-center gap-3 p-8">
      <div className="label mb-2">Open findings by site · worst first</div>
      {sites.map((s, i) => (
        <div key={s.site} className="grid grid-cols-[130px_1fr_40px] items-center gap-3">
          <span className="truncate text-[13px]">{s.site}</span>
          <div className="flex h-3 overflow-hidden rounded-full bg-raised">
            {SEVERITIES.map((sev) =>
              s.bySeverity[sev] ? (
                <motion.span
                  key={sev}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: 0.06 * i, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  style={{ width: `${(s.bySeverity[sev] / max) * 100}%`, backgroundColor: SEVERITY_COLOR[sev], transformOrigin: 'left' }}
                />
              ) : null,
            )}
          </div>
          <span className="num text-right font-mono text-[12px] text-ink-2">{s.open}</span>
        </div>
      ))}
      <div className="mt-3 flex flex-wrap gap-3 font-mono text-[10.5px] text-ink-3">
        {SEVERITIES.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: SEVERITY_COLOR[s] }} />
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

function ActionVisual() {
  const asset = landingAsset('vo-road-collapse');
  const [hash, setHash] = useState<string | null>(null);
  useEffect(() => {
    const payload = JSON.stringify(findingRecords(LANDING_ASSETS).map((r) => ({ id: r.finding.id, severity: r.finding.severity, status: r.finding.status })));
    let cancelled = false;
    sha256Hex(payload).then((h) => !cancelled && setHash(h));
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div className="flex h-full items-center justify-center bg-canvas p-8">
      <div className="w-full max-w-md rotate-[-1.2deg] rounded-[10px] bg-paper p-5 text-paper-ink shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]">
        <div className="flex items-center justify-between font-mono text-[10.5px] text-black/55">
          <span>VisualOps · Inspection report</span>
          <span>VO-1042</span>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- stamped Cloudinary evidence frame */}
        <img src={evidenceStillUrl(asset, true, 900)} alt="Stamped evidence frame" className="mt-3 w-full rounded-[6px]" />
        <div className="mt-3 text-[14px] font-semibold">{asset.finding?.title}</div>
        <p className="mt-1 text-[12px] leading-relaxed text-black/70">{asset.finding?.action}</p>
        <div className="mt-3 border-t border-black/10 pt-2 font-mono text-[9.5px] text-black/55">SHA-256 {hash ? `${hash.slice(0, 32)}…` : '…'}</div>
      </div>
    </div>
  );
}

