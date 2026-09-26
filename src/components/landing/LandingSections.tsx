'use client';

import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { refOf, stillBase, thumbUrl } from '@/lib/cloudinary/media';
import { IMAGE_ACCEPT, measure } from '@/lib/cloudinary/probe';
import { component, deliveryUrl } from '@/lib/cloudinary/url';
import { formatBytes } from '@/lib/format';
import { Logo } from '@/components/brand/Logo';
import { cn } from '@/components/ui/cn';
import { landingAsset } from './landing-data';

/* ---------------------------------------------------------------------- */
/* Nav                                                                     */
/* ---------------------------------------------------------------------- */

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b transition-colors duration-200',
        scrolled ? 'border-line bg-canvas/85 backdrop-blur-md' : 'border-transparent bg-transparent',
      )}
    >
      <nav className="mx-auto flex h-14 max-w-[1320px] items-center gap-6 px-4 sm:px-6" aria-label="Main">
        <Link href="/" aria-label="VisualOps home">
          <Logo />
        </Link>
        <div className="hidden items-center gap-5 text-[13px] text-ink-2 md:flex">
          <a href="#pipeline" className="hover:text-ink">Pipeline</a>
          <a href="#cloudinary" className="hover:text-ink">Cloudinary</a>
          <a href="#integrity" className="hover:text-ink">Evidence integrity</a>
          <a href="#run" className="hover:text-ink">Run it</a>
        </div>
        <Link href="/console" className="btn btn-primary btn-sm ml-auto">
          Open console <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </nav>
    </header>
  );
}

/* ---------------------------------------------------------------------- */
/* Built on Cloudinary — live capability cards                             */
/* ---------------------------------------------------------------------- */

interface Capability {
  title: string;
  code: string;
  body: string;
  before: string;
  after: string;
  kind?: 'image' | 'video';
  tone?: 'evidence' | 'ai-edit' | 'generative';
  checker?: boolean;
  measureId?: string;
}

function capabilities(): Capability[] {
  const road = landingAsset('vo-road-collapse');
  const crew = landingAsset('vo-crew-ppe');
  const tools = landingAsset('vo-tool-crib');
  const truck = landingAsset('vo-fleet-checkin');
  const wet = landingAsset('vo-wet-floor');
  const drone = landingAsset('vo-demolition-deck');
  const label = landingAsset('vo-receiving-label');
  const box = (w: number, h: number) => component({ c: 'pad', b: 'rgb:14171c', w, h });
  const img = (a: typeof road, comps: string[], ext?: string) => deliveryUrl(refOf(a), comps, ext);
  return [
    {
      title: 'Subject-aware crop',
      code: 'c_fill,ar_1:1,g_auto',
      body: 'Cloudinary finds what matters in the frame and crops around it — here, the collapse.',
      before: img(road, [box(800, 600)]),
      after: img(road, [component({ ar: '1:1', c: 'fill', g: 'auto', w: 600 }), box(800, 600), 'q_auto', 'f_auto']),
      tone: 'evidence',
    },
    {
      title: 'Face redaction',
      code: 'e_pixelate_faces',
      body: 'People are detected and pixelated before media leaves the team.',
      before: img(crew, [component({ c: 'fill', g: 'auto', w: 800, h: 600 })]),
      after: img(crew, ['e_pixelate_faces:20', component({ c: 'fill', g: 'auto', w: 800, h: 600 }), 'q_auto', 'f_auto']),
      tone: 'evidence',
    },
    {
      title: 'AI upscale',
      code: 'e_upscale',
      body: 'A 328 px intake photo becomes readable. Marked generative — useful for identification, never evidence.',
      before: img(tools, [component({ c: 'pad', w: 800, h: 600, b: 'white' })]),
      after: img(tools, ['e_upscale', component({ c: 'pad', w: 800, h: 600, b: 'white' }), 'q_auto', 'f_auto']),
      tone: 'generative',
    },
    {
      title: 'Background removal',
      code: 'e_background_removal',
      body: 'Vehicles and tools isolated for a clean asset register.',
      before: img(truck, [component({ c: 'fill', g: 'auto', w: 800, h: 600 })]),
      after: img(truck, ['e_background_removal', component({ c: 'pad', w: 800, h: 600 }), 'f_auto']),
      tone: 'ai-edit',
      checker: true,
    },
    {
      title: 'Remediation preview',
      code: 'e_gen_replace:from_mop;to_…sign',
      body: 'Generative replace shows the corrective action for a briefing: a warning sign where the mop was.',
      before: img(wet, [component({ c: 'fill', g: 'auto', w: 800, h: 600 })]),
      after: img(wet, ['e_gen_replace:from_mop;to_yellow%20wet%20floor%20warning%20sign', component({ c: 'fill', g: 'auto', w: 800, h: 600 }), 'q_auto', 'f_auto']),
      tone: 'generative',
    },
    {
      title: 'Frames from footage',
      code: 'so_12 → .jpg',
      body: 'Any moment of a drone pass becomes an inspection still, extracted by Cloudinary.',
      before: deliveryUrl(refOf(drone), [...stillBase(drone), component({ c: 'fill', w: 800, h: 600 })], 'jpg'),
      after: deliveryUrl(refOf(drone), [component({ so: 12 }), component({ c: 'fill', w: 800, h: 600 }), 'q_auto', 'f_auto'], 'jpg'),
      tone: 'evidence',
    },
    {
      title: 'AI video highlights',
      code: 'e_preview:duration_6',
      body: 'Cloudinary condenses long footage into its most relevant seconds.',
      before: deliveryUrl(refOf(drone), [...stillBase(drone), component({ c: 'fill', w: 800, h: 600 })], 'jpg'),
      after: deliveryUrl(refOf(drone), ['e_preview:duration_6', component({ c: 'fill', w: 800, h: 600 }), 'ac_none', 'q_auto', 'vc_auto'], 'mp4'),
      kind: 'video',
      tone: 'ai-edit',
    },
    {
      title: 'Automatic delivery',
      code: 'q_auto,f_auto',
      body: 'A 4032 × 3024 phone JPEG served at display size in the best format your browser supports.',
      before: img(label, [component({ c: 'fill', g: 'auto', w: 800, h: 600 })]),
      after: img(label, [component({ c: 'fill', g: 'auto', w: 800, h: 600 }), 'q_auto', 'f_auto']),
      tone: 'evidence',
      measureId: 'vo-receiving-label',
    },
  ];
}

const TONE: Record<NonNullable<Capability['tone']>, { label: string; cls: string }> = {
  evidence: { label: 'Evidence-safe', cls: 'text-signal' },
  'ai-edit': { label: 'AI edit', cls: 'text-medium' },
  generative: { label: 'Generative', cls: 'text-high' },
};

export function CloudinaryProof() {
  const items = capabilities();
  return (
    <section id="cloudinary" className="border-b border-line">
      <div className="mx-auto max-w-[1320px] px-4 py-20 sm:px-6 lg:py-28">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="label">Built on Cloudinary</p>
            <h2 className="mt-4 text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[44px]">Not a mock-up. Hover any card.</h2>
            <p className="mt-4 text-[16px] leading-relaxed text-ink-2">
              Each card requests a real Cloudinary transformation on the sample dataset. Open the URL and it renders the same for anyone.
            </p>
          </div>
          <Link href="/console#studio" className="btn btn-secondary">
            Build your own pipeline <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <CapabilityCard key={item.title} item={item} />
          ))}
        </div>
      </div>
    </section>
  );
}

function CapabilityCard({ item }: { item: Capability }) {
  const [on, setOn] = useState(false);
  const [bytes, setBytes] = useState<{ before?: number; after?: number; format?: string } | null>(null);

  useEffect(() => {
    if (!item.measureId || !on || bytes) return;
    let cancelled = false;
    measure(item.after, { accept: IMAGE_ACCEPT }).then((r) => {
      if (!cancelled && r.kind === 'ready') setBytes({ before: r.metrics.originalBytes, after: r.metrics.bytes, format: r.metrics.format });
    });
    return () => {
      cancelled = true;
    };
  }, [item, on, bytes]);

  const tone = item.tone ? TONE[item.tone] : null;
  return (
    <article
      tabIndex={0}
      onMouseEnter={() => setOn(true)}
      onMouseLeave={() => setOn(false)}
      onFocus={() => setOn(true)}
      onBlur={() => setOn(false)}
      onClick={() => setOn((v) => !v)}
      className="group panel flex flex-col overflow-hidden outline-offset-4 transition-colors hover:border-line-strong"
    >
      <div className={cn('relative aspect-[4/3] overflow-hidden border-b border-line', item.checker ? 'checker' : 'bg-raised')}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
        <img src={item.before} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        {on &&
          (item.kind === 'video' ? (
            <video src={item.after} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- Cloudinary transformation under demonstration
            <img src={item.after} alt="" className={cn('absolute inset-0 h-full w-full object-cover', item.checker && 'checker')} />
          ))}
        <span className="absolute left-2.5 top-2.5 rounded-[5px] bg-canvas/85 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-2 backdrop-blur-sm">
          {on ? 'Cloudinary' : 'Original'}
        </span>
        {bytes?.before && bytes.after && on && (
          <span className="num absolute bottom-2.5 right-2.5 rounded-[5px] bg-canvas/85 px-1.5 py-0.5 font-mono text-[10.5px] text-signal backdrop-blur-sm">
            {formatBytes(bytes.before)} → {formatBytes(bytes.after)} {bytes.format?.toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[14px] font-semibold tracking-[-0.01em]">{item.title}</h3>
          {tone && <span className={cn('font-mono text-[10px] uppercase tracking-[0.06em]', tone.cls)}>{tone.label}</span>}
        </div>
        <p className="mt-1.5 flex-1 text-[12.5px] leading-relaxed text-ink-3">{item.body}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <code className="truncate font-mono text-[11px] text-ink-2">{item.code}</code>
          <a
            href={item.after}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex shrink-0 items-center gap-0.5 font-mono text-[11px] text-ink-3 hover:text-ink"
            aria-label={`Open the ${item.title} Cloudinary URL`}
          >
            URL <ArrowUpRight className="h-3 w-3" />
          </a>
        </div>
      </div>
    </article>
  );
}

/* ---------------------------------------------------------------------- */
/* Evidence integrity                                                      */
/* ---------------------------------------------------------------------- */

export function Integrity() {
  const columns = [
    {
      tone: 'text-signal',
      title: 'Evidence-safe',
      body: 'Crop, resize, exposure, sharpening, face redaction, audit stamps, format and quality. Nothing is invented — suitable for inspection records and reports.',
      code: 'g_auto · e_improve · e_sharpen · e_pixelate_faces · l_text · q_auto · f_auto',
    },
    {
      tone: 'text-medium',
      title: 'AI edit',
      body: 'AI removes or selects content without inventing it: background removal, video highlights. Labelled when shared; the original stays the record.',
      code: 'e_background_removal · e_preview · e_enhance',
    },
    {
      tone: 'text-high',
      title: 'Generative',
      body: 'New pixels are synthesised. Great for briefings, catalogs and remediation previews — never admissible as evidence, and never placed in a report.',
      code: 'e_gen_replace · e_gen_remove · e_gen_recolor · e_gen_background_replace · b_gen_fill · e_gen_restore · e_upscale',
    },
  ];
  return (
    <section id="integrity" className="border-b border-line">
      <div className="mx-auto max-w-[1320px] px-4 py-20 sm:px-6 lg:py-24">
        <div className="max-w-2xl">
          <p className="label">Evidence integrity</p>
          <h2 className="mt-4 text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[44px]">Generative AI never touches the record.</h2>
          <p className="mt-4 text-[16px] leading-relaxed text-ink-2">
            Inspection media only matters if you can trust it. Every Cloudinary step in VisualOps carries an integrity class, the pipeline shows the result, and reports use evidence-safe renditions only.
          </p>
        </div>
        <div className="mt-12 grid gap-px overflow-hidden rounded-[14px] border border-line bg-line md:grid-cols-3">
          {columns.map((c) => (
            <div key={c.title} className="bg-surface p-6">
              <div className={cn('font-mono text-[11px] uppercase tracking-[0.08em]', c.tone)}>{c.title}</div>
              <p className="mt-3 text-[14px] leading-relaxed text-ink-2">{c.body}</p>
              <p className="mt-4 font-mono text-[11px] leading-relaxed text-ink-3">{c.code}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------- */
/* Run it + footer                                                         */
/* ---------------------------------------------------------------------- */

export function RunIt() {
  const tiles = ['vo-road-collapse', 'vo-hot-work', 'vo-washroom-panel', 'vo-equipment-yard'].map(landingAsset);
  return (
    <section id="run" className="border-b border-line">
      <div className="mx-auto grid max-w-[1320px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-24">
        <div>
          <p className="label">Run it</p>
          <h2 className="mt-4 text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[44px]">Your media already has the answers.</h2>
          <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-ink-2">
            The console works out of the box on Cloudinary’s demo cloud. Point it at your own cloud with an unsigned upload preset and your field
            captures flow through the same pipeline — no API secret, anywhere.
          </p>
          <div className="mt-6 overflow-hidden rounded-[12px] border border-line bg-surface">
            <div className="border-b border-line px-4 py-2 font-mono text-[11px] text-ink-3">.env.local</div>
            <pre className="code overflow-x-auto px-4 py-3 text-ink">
{`NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your_cloud_name
NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=your_unsigned_preset
NEXT_PUBLIC_VISUALOPS_TAG=visualops`}
            </pre>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/console" className="btn btn-primary h-11 px-5 text-[14px]">
              Open the console <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/console#reports" className="btn btn-secondary h-11 px-5 text-[14px]">
              See a report
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {tiles.map((a) => (
            <Link key={a.id} href={`/console#library/${a.id}`} className="group relative aspect-[4/3] overflow-hidden rounded-[12px] border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
              <img src={thumbUrl(a, 640, 480)} alt={a.title} loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2.5 pt-8">
                <span className="block font-mono text-[10.5px] text-white/70">{a.finding?.id} · {a.site}</span>
                <span className="block truncate text-[12.5px] font-medium text-white">{a.finding?.title}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="mx-auto max-w-[1320px] px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-8">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-3 text-[13px] leading-relaxed text-ink-3">
            Built by Team Rocket for Pixels to Products — the Cloudinary AI Hackathon 2026, Track 1: AI Media Pipelines.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-[13px] text-ink-2">
          <Link href="/console" className="hover:text-ink">Console</Link>
          <a href="https://cloudinary.com/documentation" target="_blank" rel="noreferrer" className="hover:text-ink">Cloudinary docs</a>
          <Link href="/console#studio" className="hover:text-ink">Studio</Link>
          <a href="https://github.com/iabhishekn/pixels-to-products-cloudinary-ai-hackathon-2026-team-rocket" target="_blank" rel="noreferrer" className="hover:text-ink">Source</a>
          <Link href="/console#reports" className="hover:text-ink">Reports</Link>
          <a href="#integrity" className="hover:text-ink">Evidence integrity</a>
        </div>
      </div>
      <p className="mt-10 border-t border-line pt-6 text-[12px] leading-relaxed text-ink-3">
        Sample media is hosted on Cloudinary’s public demo cloud and used for demonstration. Findings on the sample dataset are annotations written by
        the VisualOps team describing what is visible; Cloudinary AI signals are fetched live.
      </p>
    </footer>
  );
}
