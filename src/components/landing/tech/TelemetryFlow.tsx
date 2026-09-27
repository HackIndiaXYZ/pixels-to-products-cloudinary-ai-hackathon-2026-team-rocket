'use client';

import { motion } from 'framer-motion';
import { ArrowRight, ArrowUpRight, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { ENV_SETTINGS } from '@/lib/cloudinary/config';
import { faceDetections, fetchInsight, type CloudinaryInsight } from '@/lib/cloudinary/insights';
import { refOf, thumbUrl } from '@/lib/cloudinary/media';
import { IMAGE_ACCEPT, measure, type ProbeResult } from '@/lib/cloudinary/probe';
import { component, DELIVERY_ORIGIN, deliveryUrl, encodePublicId } from '@/lib/cloudinary/url';
import { formatBytes, formatMs } from '@/lib/format';
import { useProbe } from '@/components/media/useProbe';
import { useReducedMotionPref } from '@/components/motion/hooks';
import { cn } from '@/components/ui/cn';
import { landingAsset } from '../landing-data';
import { useInsightFrom, useSeen } from './hooks';
import { SessionLog } from './SessionLog';

/* ---------------------------------------------------------------------- */
/* The specimen: one real delivery URL that exercises every stage          */
/* ---------------------------------------------------------------------- */

const SPECIMEN = landingAsset('vo-receiving-label');
const SPECIMEN_CROP = component({ ar: '16:9', c: 'fill', g: 'auto', w: 1200 });
const SPECIMEN_COMPONENTS = [SPECIMEN_CROP, 'q_auto', 'f_auto'];
const SPECIMEN_URL = deliveryUrl(refOf(SPECIMEN), SPECIMEN_COMPONENTS);
/**
 * The same crop and size without q_auto/f_auto (a plain JPEG), so OPTIMIZE is
 * credited only with what quality and format negotiation save, and the drop
 * from the 12 MP original is credited to TRANSFORM (crop + resize).
 */
const BASELINE_URL = deliveryUrl(refOf(SPECIMEN), [SPECIMEN_CROP]);
const SPECIMEN_THUMB = thumbUrl(SPECIMEN, 256, 144);
const CREW = landingAsset('vo-crew-ppe');
const loadCrewInsight = () => fetchInsight(CREW);

type StageId = 'upload' | 'store' | 'ai' | 'transform' | 'optimize' | 'deliver';

interface Stage {
  id: StageId;
  name: string;
  role: string;
  params: Array<[code: string, note: string]>;
}

/** The parameters VisualOps actually uses at each stage (see src/lib/cloudinary). */
const STAGES: Stage[] = [
  {
    id: 'upload',
    name: 'Upload',
    role: 'Browser straight to Cloudinary. The server only signs the request.',
    params: [
      ['auto/upload', 'Upload API · image or video'],
      ['signature', 'server-signed · API secret stays on the server'],
      ['tags', 'visualops · category · site'],
      ['context', 'title · site · severity · note'],
    ],
  },
  {
    id: 'store',
    name: 'Cloudinary',
    role: 'System of record for originals and their metadata.',
    params: [
      ['public_id', 'identity of the capture'],
      ['resource_type', 'image · video'],
      ['Search API', 'records read back server-side'],
      ['context.custom', 'fields travel with the file'],
    ],
  },
  {
    id: 'ai',
    name: 'AI',
    role: 'Cloudinary’s models read the frame. Always labelled AI detected.',
    params: [
      ['detection', 'captioning · coco_v2 objects (team cloud)'],
      ['auto_tagging', 'detected labels become tags'],
      ['fl_getinfo', 'g_auto crop + face detections'],
      ['g_auto', 'subject-aware gravity'],
    ],
  },
  {
    id: 'transform',
    name: 'Transform',
    role: 'Every edit is a URL component.',
    params: [
      ['c_fill · c_limit', 'crop and resize'],
      ['so_', 'stills from footage'],
      ['e_background_removal', 'AI edit · labelled'],
      ['e_gen_* · e_upscale', 'generative · labelled'],
    ],
  },
  {
    id: 'optimize',
    name: 'Optimize',
    role: 'Negotiated per browser, per request.',
    params: [
      ['q_auto', 'perceptual quality'],
      ['f_auto', 'AVIF · WebP · JPEG'],
      ['vc_auto', 'video codec'],
    ],
  },
  {
    id: 'deliver',
    name: 'Delivery',
    role: 'Served from the edge, and measured.',
    params: [
      ['res.cloudinary.com', 'CDN delivery'],
      ['Server-Timing', 'bytes · format · cache · ms'],
      ['HTTP 423', 'async AI still rendering'],
    ],
  },
];

function paramStage(param: string): StageId {
  if (/^(g_|e_pixelate|e_blur_faces|fl_getinfo)/.test(param)) return 'ai';
  if (/^(q_|f_|vc_)/.test(param)) return 'optimize';
  return 'transform';
}

interface Token {
  text: string;
  stage?: StageId;
}

/** The specimen URL split into tokens; joined, they are exactly SPECIMEN_URL. */
const TOKENS: Token[] = (() => {
  const t: Token[] = [
    { text: DELIVERY_ORIGIN, stage: 'deliver' },
    { text: '/' },
    { text: encodeURIComponent(SPECIMEN.cloudName), stage: 'store' },
    { text: '/' },
    { text: `${SPECIMEN.resourceType}/upload`, stage: 'upload' },
  ];
  for (const comp of SPECIMEN_COMPONENTS) {
    t.push({ text: '/' });
    comp.split(',').forEach((param, i) => {
      if (i) t.push({ text: ',' });
      t.push({ text: param, stage: paramStage(param) });
    });
  }
  t.push({ text: '/' }, { text: encodePublicId(SPECIMEN.publicId), stage: 'store' });
  return t;
})();

/* ---------------------------------------------------------------------- */
/* Live readouts                                                           */
/* ---------------------------------------------------------------------- */

type ReadoutState = 'pending' | 'ready' | 'error';

interface Readout {
  state: ReadoutState;
  source: 'Live' | 'Config';
  primary: string;
  secondary: string;
}

/** A failed probe in words. Only an X-Cld-Error header is quoted as Cloudinary's own explanation. */
function probeFailure(probe: ProbeResult | undefined): string | null {
  if (!probe) return null;
  if (probe.kind === 'error') {
    return probe.source === 'x-cld-error' ? `HTTP ${probe.status} · Cloudinary: ${probe.message}` : `HTTP ${probe.status}`;
  }
  if (probe.kind === 'network') return 'Cloudinary unreachable from this browser';
  return null;
}

const pct = (ratio: number) => `${ratio >= 0 ? '−' : '+'}${Math.abs(ratio * 100).toFixed(1)}%`;

function readouts(
  probe: ProbeResult | undefined,
  baseline: ProbeResult | undefined,
  insight: CloudinaryInsight | null,
  insightFailed: boolean,
  busy: boolean,
): Record<StageId, Readout> {
  const m = !busy && probe?.kind === 'ready' ? probe.metrics : undefined;
  const base = !busy && baseline?.kind === 'ready' ? baseline.metrics : undefined;
  const baseFailed = !busy && (baseline?.kind === 'error' || baseline?.kind === 'network');
  const failure = busy ? null : probeFailure(probe);
  const pending = (source: Readout['source'] = 'Live'): Readout => ({
    state: failure ? 'error' : 'pending',
    source,
    primary: failure ? 'Unavailable' : 'Measuring…',
    secondary: failure ?? 'awaiting Cloudinary',
  });

  const originalFormat = (m?.originalFormat ?? SPECIMEN.format).toUpperCase();
  const originalBytes = m?.originalBytes ?? SPECIMEN.bytes;
  /** What q_auto/f_auto save against the same crop and size delivered as a plain JPEG. */
  const saved = m?.bytes && base?.bytes ? 1 - m.bytes / base.bytes : undefined;
  const renderTime = m?.transformMs !== undefined ? ` · rendered in ${formatMs(m.transformMs)}` : '';

  return {
    upload: {
      state: 'ready',
      source: 'Config',
      primary: `cloud_name ${ENV_SETTINGS.cloudName}`,
      secondary: ENV_SETTINGS.uploadPreset ? 'unsigned preset configured' : 'no browser preset · signed uploads need the server',
    },
    store: m
      ? {
          state: 'ready',
          source: 'Live',
          primary: `${originalFormat} · ${m.originalWidth ?? SPECIMEN.width}×${m.originalHeight ?? SPECIMEN.height}`,
          secondary: `${formatBytes(originalBytes)} original · ${SPECIMEN.fileName}`,
        }
      : pending(),
    ai: insight
      ? {
          state: 'ready',
          source: 'Live',
          primary: faceDetections(insight.faces.length),
          secondary: `fl_getinfo on ${CREW.fileName}`,
        }
      : {
          state: insightFailed ? 'error' : 'pending',
          source: 'Live',
          primary: insightFailed ? 'Unavailable' : 'Measuring…',
          secondary: insightFailed ? 'fl_getinfo request failed' : 'awaiting fl_getinfo',
        },
    transform: m
      ? {
          state: 'ready',
          source: 'Live',
          primary: m.width && m.height ? `${m.width}×${m.height} rendition` : 'rendition delivered',
          secondary: base?.bytes
            ? `crop + resize: ${formatBytes(originalBytes)} → ${formatBytes(base.bytes)} as JPEG${renderTime}`
            : `crop + resize from the ${formatBytes(originalBytes)} original${renderTime}`,
        }
      : pending(),
    optimize: m
      ? {
          state: 'ready',
          source: 'Live',
          primary: `${(m.format ?? '—').toUpperCase()} · ${formatBytes(m.bytes)}`,
          secondary:
            saved !== undefined
              ? `${pct(saved)} vs same-size JPEG`
              : baseFailed
                ? 'quality and format negotiated'
                : 'measuring the JPEG baseline…',
        }
      : pending(),
    deliver: m
      ? {
          state: 'ready',
          source: 'Live',
          primary: `${formatMs(m.elapsedMs)} round-trip`,
          secondary: [
            `CDN ${m.cache ?? 'n/a'}`,
            m.edgeMs !== undefined ? `edge ${formatMs(m.edgeMs)}` : '',
            m.cloudinaryMs !== undefined ? `origin ${formatMs(m.cloudinaryMs)}` : '',
          ]
            .filter(Boolean)
            .join(' · '),
        }
      : pending(),
  };
}

/* ---------------------------------------------------------------------- */
/* Component                                                               */
/* ---------------------------------------------------------------------- */

const EASE = [0.16, 1, 0.3, 1] as const;
/** One request pulse: 6 stages × 220 ms of presentational pacing. */
const PULSE_S = 1.32;

export function TelemetryFlow() {
  const rootRef = useRef<HTMLDivElement>(null);
  const seen = useSeen(rootRef, '0px 0px -15% 0px');
  const reduce = useReducedMotionPref();
  const probe = useProbe(SPECIMEN_URL, { accept: IMAGE_ACCEPT, enabled: seen });
  const baseline = useProbe(BASELINE_URL, { accept: IMAGE_ACCEPT, enabled: seen });
  const { insight, failed: insightFailed } = useInsightFrom(loadCrewInsight, 'crew', seen);
  const [run, setRun] = useState(0);
  const [busy, setBusy] = useState(false);
  const [hot, setHot] = useState<StageId | null>(null);

  const values = readouts(probe, baseline, insight, insightFailed, busy);
  const m = !busy && probe?.kind === 'ready' ? probe.metrics : undefined;

  const remeasure = () => {
    if (busy) return;
    setBusy(true);
    setRun((r) => r + 1);
    Promise.all([
      measure(SPECIMEN_URL, { accept: IMAGE_ACCEPT, force: true }),
      measure(BASELINE_URL, { accept: IMAGE_ACCEPT, force: true }),
    ]).finally(() => setBusy(false));
  };

  const requestLine = busy
    ? 'requesting…'
    : m
      ? `${m.status} · ${m.contentType?.split(';')[0] ?? m.format}`
      : probeFailure(probe) ?? (seen ? 'requesting…' : 'queued');

  return (
    <div ref={rootRef} className="mt-16 lg:mt-24">
      {/* Specimen request ------------------------------------------------ */}
      <div className="grid gap-5 border-t border-line py-7 lg:grid-cols-[minmax(0,2fr)_minmax(0,10fr)] lg:gap-6">
        <div>
          <p className="label">Specimen request</p>
          <p className="mt-2 max-w-[24ch] text-[12.5px] leading-snug text-ink-3">
            One delivery URL, measured by your browser when this section came into view.
          </p>
        </div>
        <div className="flex min-w-0 gap-4 sm:gap-5">
          <a
            href={SPECIMEN_URL}
            target="_blank"
            rel="noreferrer"
            data-cursor="OPEN"
            className="relative hidden aspect-video w-[132px] shrink-0 overflow-hidden rounded-[4px] border border-line bg-raised sm:block"
            aria-label={`Open the specimen image, ${SPECIMEN.fileName}, on Cloudinary (opens in a new tab)`}
          >
            {seen && (
              // eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition
              <img src={SPECIMEN_THUMB} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
            )}
          </a>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-ink-3">
              <span className="text-ink-2">HEAD</span>
              <span className={cn('num', m ? 'text-ok' : probeFailure(probe) && !busy ? 'text-critical' : 'text-ink-3')}>{requestLine}</span>
              <span className="hidden sm:inline">·</span>
              <span className="hidden sm:inline">
                {SPECIMEN.fileName} · {SPECIMEN.site}
              </span>
              <span className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={remeasure}
                  disabled={!seen || busy}
                  className="btn btn-ghost btn-sm h-7 gap-1.5 px-2 font-mono text-[11px]"
                >
                  <RotateCw className={cn('h-3 w-3', busy && 'animate-spin')} />
                  Measure again
                </button>
                <a
                  href={SPECIMEN_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open the specimen delivery URL on Cloudinary (opens in a new tab)"
                  className="btn btn-ghost btn-sm h-7 gap-1 px-2 font-mono text-[11px]"
                >
                  Open <ArrowUpRight aria-hidden className="h-3 w-3" />
                </a>
              </span>
            </div>
            <p className="mt-3 font-mono text-[12.5px] leading-[1.7] [overflow-wrap:anywhere] sm:text-[14px] lg:text-[15px]">
              {TOKENS.map((token, i) =>
                token.stage ? (
                  <span
                    key={i}
                    onPointerEnter={() => setHot(token.stage ?? null)}
                    onPointerLeave={() => setHot(null)}
                    className={cn(
                      'whitespace-nowrap rounded-[2px] transition-colors duration-200',
                      hot === null ? 'text-ink' : hot === token.stage ? 'bg-signal/12 text-signal' : 'text-ink-3',
                    )}
                  >
                    {token.text}
                  </span>
                ) : (
                  <span key={i} className="text-ink-3">
                    {token.text}
                    <wbr />
                  </span>
                ),
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Stage flow ------------------------------------------------------ */}
      <div className="relative border-t border-line">
        {/* Request pulse — once on entry, once per re-measure. */}
        {seen && !reduce && (
          <>
            <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-px hidden h-[2px] overflow-hidden lg:block">
              <motion.div
                key={run}
                className="h-full w-full"
                initial={{ x: '-100%', opacity: 1 }}
                animate={{ x: '0%', opacity: [1, 1, 0] }}
                transition={{ x: { duration: PULSE_S, ease: 'linear' }, opacity: { duration: PULSE_S + 0.35, times: [0, 0.78, 1] } }}
              >
                <span className="absolute right-0 top-0 h-full w-28 bg-[linear-gradient(90deg,transparent,var(--color-signal))]" />
              </motion.div>
            </div>
            <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[2px] -translate-x-1/2 overflow-hidden lg:hidden">
              <motion.div
                key={run}
                className="h-full w-full"
                initial={{ y: '-100%', opacity: 1 }}
                animate={{ y: '0%', opacity: [1, 1, 0] }}
                transition={{ y: { duration: PULSE_S * 1.4, ease: 'linear' }, opacity: { duration: PULSE_S * 1.4 + 0.35, times: [0, 0.8, 1] } }}
              >
                <span className="absolute bottom-0 left-0 h-24 w-full bg-[linear-gradient(180deg,transparent,var(--color-signal))]" />
              </motion.div>
            </div>
          </>
        )}

        <ol className="grid border-l border-line lg:grid-cols-6 lg:border-l-0">
          {STAGES.map((stage, i) => {
            const value = values[stage.id];
            const isHot = hot === stage.id;
            return (
              <li
                key={stage.id}
                onPointerEnter={() => setHot(stage.id)}
                onPointerLeave={() => setHot(null)}
                className={cn(
                  'relative flex flex-col pb-7 pl-6 pt-6 sm:pb-8 sm:pt-7 lg:px-5 lg:pb-7',
                  i > 0 && 'lg:border-l lg:border-line',
                  i === 0 && 'lg:pl-0',
                )}
              >
                {/* Junction node on the flow line */}
                <span
                  aria-hidden
                  style={{ transitionDelay: value.state === 'ready' ? `${i * 180}ms` : '0ms' }}
                  className={cn(
                    'absolute -left-[4px] top-7 h-[7px] w-[7px] border transition-colors duration-300 sm:top-8 lg:-top-[4px]',
                    value.state === 'ready'
                      ? 'border-signal bg-signal'
                      : value.state === 'error'
                        ? 'border-critical bg-critical'
                        : 'border-line-strong bg-canvas',
                  )}
                />
                {i === STAGES.length - 1 && (
                  <span
                    aria-hidden
                    style={{ transitionDelay: value.state === 'ready' ? `${(i + 1) * 180}ms` : '0ms' }}
                    className={cn(
                      'absolute -right-[4px] -top-[4px] hidden h-[7px] w-[7px] border transition-colors duration-300 lg:block',
                      value.state === 'ready' ? 'border-signal bg-signal' : 'border-line-strong bg-canvas',
                    )}
                  />
                )}
                {/* Hover marker on the column's segment of the line */}
                <span
                  aria-hidden
                  style={{ transform: `scaleX(${isHot ? 1 : 0})`, opacity: isHot ? 1 : 0 }}
                  className="pointer-events-none absolute -top-px left-0 hidden h-px w-full origin-left bg-signal transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] lg:block"
                />

                <div className="flex items-baseline justify-between font-mono text-[11px] text-ink-3">
                  <span className="num">{String(i + 1).padStart(2, '0')}</span>
                  <span className={cn('label transition-colors duration-200', value.state === 'ready' ? 'text-ink-2' : 'text-ink-3')}>
                    {value.source}
                  </span>
                </div>
                <h3
                  className={cn(
                    'type-poster mt-2 text-[30px] transition-colors duration-200 sm:mt-3 sm:text-[40px] lg:mt-5 lg:text-[clamp(26px,2.5vw,36px)]',
                    isHot ? 'text-signal' : 'text-ink',
                  )}
                >
                  {stage.name}
                </h3>
                <p className="mt-2.5 max-w-[34ch] text-[13px] leading-snug text-ink-2 lg:min-h-[3.3em]">{stage.role}</p>

                {/* Compact on small screens: the parameters alone. */}
                <p className="mt-4 font-mono text-[11px] leading-[1.7] text-ink sm:hidden">
                  {stage.params.map(([code], k) => (
                    <span key={code}>
                      {k > 0 && <span className="text-ink-3"> · </span>}
                      {code}
                    </span>
                  ))}
                </p>
                <ul className="mt-5 hidden gap-x-6 gap-y-2.5 font-mono text-[11px] sm:grid sm:grid-cols-2 lg:grid-cols-1">
                  {stage.params.map(([code, note]) => (
                    <li key={code} className="min-w-0">
                      <div className="break-words text-ink">{code}</div>
                      <div className="break-words text-ink-3">{note}</div>
                    </li>
                  ))}
                </ul>

                <div className="mt-5 border-t border-dashed border-line-strong pt-3 sm:mt-6 lg:mt-auto">
                  <div>
                    <motion.div
                      key={`${value.state}-${value.primary}`}
                      initial={reduce ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, delay: value.state === 'ready' ? i * 0.18 : 0, ease: EASE }}
                    >
                      <div
                        className={cn(
                          'num truncate font-mono text-[13px]',
                          value.state === 'ready' ? 'text-ink' : value.state === 'error' ? 'text-critical' : 'text-ink-3',
                        )}
                      >
                        {value.primary}
                      </div>
                      <div className="num mt-1 break-words lg:min-h-[2.8em] font-mono text-[11px] leading-[1.4] text-ink-3">{value.secondary}</div>
                    </motion.div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Studio cross-reference --------------------------------------------- */}
      <div className="flex flex-col gap-x-6 gap-y-2 border-t border-line py-5 sm:flex-row sm:items-baseline sm:justify-between">
        <p className="text-[13px] leading-relaxed text-ink-3">
          The Studio runs these same steps on one capture:{' '}
          <span className="whitespace-nowrap font-mono text-[12px] text-ink-2">Ingest → Understand → Classify</span>{' '}
          <span className="whitespace-nowrap font-mono text-[12px] text-ink-2">→ Transform → Optimize → Index</span>.
        </p>
        <Link
          href="/console#studio"
          className="link-underline inline-flex shrink-0 items-center gap-1.5 self-start text-[13px] font-medium text-ink sm:self-auto"
        >
          Run them in the Studio <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Session log ----------------------------------------------------- */}
      <div className="border-t border-line py-7">
        <SessionLog rows={4} />
      </div>
    </div>
  );
}
