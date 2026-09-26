'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  Download,
  ExternalLink,
  FileText,
  ScanFace,
  ShieldCheck,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MediaAsset } from '@/lib/types';
import {
  displayUrl,
  downloadOriginalUrl,
  evidenceUrl,
  originalUrl,
  playbackUrl,
  redactedUrl,
} from '@/lib/cloudinary/media';
import { IMAGE_ACCEPT } from '@/lib/cloudinary/probe';
import { PRESETS, presetSteps } from '@/lib/cloudinary/pipeline';
import { formatBytes, formatDateTime } from '@/lib/format';
import { MediaFrame } from '@/components/media/MediaFrame';
import { ProbedImage, ProbedVideo } from '@/components/media/Probed';
import { RegionLayer } from '@/components/media/RegionLayer';
import { FrameStrip } from '@/components/media/FrameStrip';
import { DeliveryReceipt } from '@/components/media/DeliveryReceipt';
import { useProbe } from '@/components/media/useProbe';
import { CategoryTag, LiveDot, SeverityBadge, StatusBadge } from '@/components/ui/badges';
import { CopyButton } from '@/components/ui/CopyButton';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/components/ui/cn';
import { useConsole } from './store';
import { servedUrl, useInsight } from './hooks';

type StillView = 'original' | 'evidence' | 'redacted';

export function Inspector() {
  const { inspectId, inspect, getAsset } = useConsole();
  const asset = getAsset(inspectId);

  useEffect(() => {
    if (!asset) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') inspect(null);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [asset, inspect]);

  return (
    <AnimatePresence>
      {asset && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={asset.title}>
          <motion.div
            className="absolute inset-0 bg-black/75"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => inspect(null)}
          />
          <InspectorPanel key={asset.id} asset={asset} />
        </div>
      )}
    </AnimatePresence>
  );
}

function InspectorPanel({ asset }: { asset: MediaAsset }) {
  const { inspect, openInStudio, reportFor, removeUserAsset } = useConsole();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<StillView>('original');
  const [showAnnotation, setShowAnnotation] = useState(true);
  const [showFocus, setShowFocus] = useState(false);
  const [showFaces, setShowFaces] = useState(true);
  const [duration, setDuration] = useState<number | undefined>(asset.duration);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { insight, error: insightError } = useInsight(asset);
  const served = useProbe(servedUrl(asset), { accept: asset.resourceType === 'image' ? IMAGE_ACCEPT : undefined });
  const finding = asset.finding;
  const isVideo = asset.resourceType === 'video';

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  const stillUrl = view === 'evidence' ? evidenceUrl(asset) : view === 'redacted' ? redactedUrl(asset) : displayUrl(asset, 2000);
  const facePreset = PRESETS.find((p) => p.id === 'privacy-redaction')!;
  const evidencePreset = PRESETS.find((p) => p.id === (isVideo ? 'field-clip' : 'evidence-enhance'))!;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="relative z-10 flex w-full max-w-[1320px] flex-col overflow-hidden border-line-strong bg-surface shadow-[0_30px_100px_-20px_rgba(0,0,0,0.9)] sm:rounded-[14px] sm:border lg:flex-row"
    >
      {/* Media stage */}
      <div className="relative flex min-h-0 flex-1 flex-col bg-canvas lg:min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          {isVideo ? (
            <span className="label">Playback · c_limit,w_1280 / q_auto / vc_auto</span>
          ) : (
            <Segmented
              size="sm"
              ariaLabel="Rendition"
              value={view}
              onChange={setView}
              options={[
                { value: 'original', label: 'Original', title: 'Stored file, resized only' },
                { value: 'evidence', label: 'Evidence view', title: 'e_improve + e_sharpen — nothing generated' },
                { value: 'redacted', label: 'Faces redacted', title: 'e_pixelate_faces' },
              ]}
            />
          )}
          <div className="flex items-center gap-1">
            {finding?.region && <Toggle on={showAnnotation} onChange={setShowAnnotation} label="Annotation" />}
            {!isVideo && <Toggle on={showFocus} onChange={setShowFocus} label="g_auto region" live />}
            {!isVideo && insight && insight.faces.length > 0 && <Toggle on={showFaces} onChange={setShowFaces} label={`Faces (${insight.faces.length})`} live />}
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center overflow-auto p-3 sm:p-5">
          <motion.div layoutId={`media-${asset.id}`} className="w-full">
            {isVideo ? (
              <MediaFrame width={asset.width} height={asset.height} maxHeight="58vh" className="rounded-[8px] border border-line bg-black">
                <ProbedVideo
                  url={playbackUrl(asset)}
                  poster={displayUrl(asset, 1280)}
                  videoRef={videoRef}
                  onDuration={setDuration}
                />
              </MediaFrame>
            ) : (
              <MediaFrame width={asset.width} height={asset.height} maxHeight="68vh" className="checker rounded-[8px] border border-line">
                <ProbedImage url={stillUrl} alt={asset.title} fit="cover" />
                {showAnnotation && finding?.region && view !== 'redacted' && <RegionLayer regions={[finding.region]} variant="annotation" />}
                {showFocus && insight?.focus && <RegionLayer regions={[{ ...insight.focus, label: 'CLOUDINARY g_auto' }]} variant="focus" />}
                {showFaces && view !== 'redacted' && insight && insight.faces.length > 0 && (
                  <RegionLayer regions={insight.faces} variant="face" />
                )}
                <span className="reticle" />
              </MediaFrame>
            )}
          </motion.div>
        </div>

        {isVideo && (
          <div className="border-t border-line p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="label">Keyframes extracted by Cloudinary (so_)</span>
              {duration ? <span className="num font-mono text-[11px] text-ink-3">{duration.toFixed(1)} s</span> : null}
            </div>
            <FrameStrip
              asset={asset}
              duration={duration}
              onSeek={(t) => {
                const v = videoRef.current;
                if (v) {
                  v.currentTime = t;
                  void v.play().catch(() => undefined);
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Record */}
      <aside className="flex w-full shrink-0 flex-col border-t border-line lg:w-[420px] lg:border-l lg:border-t-0">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="truncate font-mono text-[11.5px] text-ink-3">{asset.fileName}</div>
            <h2 className="mt-1 text-[17px] font-semibold leading-snug tracking-[-0.015em]">{finding?.title ?? asset.title}</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {finding && <SeverityBadge severity={finding.severity} />}
              {finding && <StatusBadge status={finding.status} />}
              {finding && <CategoryTag category={finding.category} />}
              {finding && <span className="chip bg-transparent">{finding.id}</span>}
            </div>
          </div>
          <button ref={closeRef} type="button" onClick={() => inspect(null)} className="btn btn-ghost btn-sm btn-icon -mr-2" aria-label="Close inspector">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <dl className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
            <dt className="text-ink-3">Location</dt>
            <dd>
              {asset.site}
              {asset.zone ? ` · ${asset.zone}` : ''}
            </dd>
            <dt className="text-ink-3">Captured</dt>
            <dd className="num">{formatDateTime(asset.capturedAt)}</dd>
            <dt className="text-ink-3">By</dt>
            <dd>{asset.capturedBy}</dd>
            <dt className="text-ink-3">Media</dt>
            <dd className="num font-mono text-[11.5px] text-ink-2">
              {asset.resourceType} · {asset.format.toUpperCase()} · {asset.width}×{asset.height} · {formatBytes(asset.bytes)}
            </dd>
          </dl>

          {finding && (
            <section className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="label">Finding</h3>
                <span className="font-mono text-[10.5px] text-ink-3">
                  {asset.source === 'sample' ? 'Sample annotation' : 'Reported at ingest'}
                </span>
              </div>
              <p className="text-[13px] leading-relaxed text-ink-2">{finding.summary}</p>
              <div className="rounded-[8px] border border-line bg-raised px-3 py-2.5">
                <div className="label">Action</div>
                <p className="mt-1 text-[13px] leading-relaxed">{finding.action}</p>
              </div>
            </section>
          )}

          <section className="space-y-2.5">
            <h3 className="label flex items-center gap-1.5">
              <LiveDot /> Cloudinary AI signals · live
            </h3>
            {insight ? (
              <ul className="space-y-1.5 text-[12.5px]">
                <li className="flex justify-between gap-3">
                  <span className="text-ink-3">Subject region (g_auto)</span>
                  <span className="num font-mono text-[11.5px]">
                    {insight.focus ? `${Math.round(insight.focus.x)}%, ${Math.round(insight.focus.y)}% · ${Math.round(insight.focus.w)}×${Math.round(insight.focus.h)}%` : '—'}
                  </span>
                </li>
                <li className="flex justify-between gap-3">
                  <span className="text-ink-3">Faces detected</span>
                  <span className="num font-mono text-[11.5px]">{insight.faces.length}</span>
                </li>
                <li className="flex justify-between gap-3">
                  <span className="text-ink-3">Analysed frame</span>
                  <span className="num font-mono text-[11.5px]">
                    {insight.inputWidth}×{insight.inputHeight}
                    {isVideo ? ` @ ${asset.posterOffset ?? 1}s` : ''}
                  </span>
                </li>
                {insight.faces.length > 0 && (
                  <li className="flex items-start gap-2 rounded-[8px] border border-[color-mix(in_oklab,var(--color-signal)_30%,transparent)] px-3 py-2 text-[12px] text-ink-2">
                    <ScanFace className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal" />
                    People are identifiable. Share the redacted rendition outside the team.
                  </li>
                )}
                <li className="pt-1">
                  <a href={insight.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-3 hover:text-ink">
                    fl_getinfo JSON <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
              </ul>
            ) : (
              <p className="text-[12.5px] text-ink-3">{insightError ? `Unavailable: ${insightError}` : 'Asking Cloudinary…'}</p>
            )}
          </section>

          <DeliveryReceipt result={served} label={isVideo ? 'Playback delivered by Cloudinary' : 'Rendition delivered by Cloudinary'} />

          {asset.tags.length > 0 && (
            <section>
              <h3 className="label">Tags</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {asset.tags.map((t) => (
                  <span key={t} className="rounded-[5px] border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                    {t}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="label">Cloudinary asset</h3>
            <div className="rounded-[8px] border border-line bg-canvas p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">
              <div>
                cloud <span className="text-ink">{asset.cloudName}</span> · {asset.resourceType}/upload
              </div>
              <div className="break-all">
                public_id <span className="text-ink">{asset.publicId}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <CopyButton value={isVideo ? playbackUrl(asset) : evidenceUrl(asset)} label="Copy delivery URL" />
              <a className="btn btn-secondary btn-sm" href={originalUrl(asset)} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" /> Original
              </a>
              <a className="btn btn-secondary btn-sm" href={downloadOriginalUrl(asset)}>
                <Download className="h-3.5 w-3.5" /> Download
              </a>
            </div>
          </section>
        </div>

        <div className="space-y-2 border-t border-line px-5 py-4">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-primary" onClick={() => openInStudio(asset.id, presetSteps(evidencePreset))}>
              <Wand2 className="h-4 w-4" /> Open in Studio
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => reportFor([asset.id], 'inspection')}>
              <FileText className="h-4 w-4" /> Report
            </button>
          </div>
          {!isVideo && (
            <button type="button" className="btn btn-ghost btn-sm w-full" onClick={() => openInStudio(asset.id, presetSteps(facePreset))}>
              <ShieldCheck className="h-3.5 w-3.5" /> Redact for sharing
            </button>
          )}
          {asset.source !== 'sample' && (
            <button
              type="button"
              className="btn btn-ghost btn-sm w-full text-ink-3"
              onClick={() => {
                removeUserAsset(asset.id);
                inspect(null);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove from this browser (stays in Cloudinary)
            </button>
          )}
        </div>
      </aside>
    </motion.div>
  );
}

function Toggle({ on, onChange, label, live = false }: { on: boolean; onChange: (v: boolean) => void; label: string; live?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-[6px] border px-2 font-mono text-[10.5px] uppercase tracking-[0.04em] transition-colors',
        on ? 'border-line-strong bg-raised text-ink' : 'border-line text-ink-3 hover:text-ink-2',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', on ? (live ? 'bg-signal' : 'bg-high') : 'bg-line-strong')} />
      {label}
    </button>
  );
}

