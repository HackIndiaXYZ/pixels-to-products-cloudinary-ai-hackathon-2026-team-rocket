'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, ScanFace, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import type { MediaAsset } from '@/lib/types';
import { CROP_LABEL, type CloudinaryInsight } from '@/lib/cloudinary/insights';
import { IMAGE_ACCEPT } from '@/lib/cloudinary/probe';
import { formatBytes, formatDuration } from '@/lib/format';
import { CloudImage } from '@/components/media/CloudImage';
import { DeliveryReceipt } from '@/components/media/DeliveryReceipt';
import { FrameStrip } from '@/components/media/FrameStrip';
import { ProbedImage, ProbedVideo } from '@/components/media/Probed';
import { RegionLayer } from '@/components/media/RegionLayer';
import { useProbe } from '@/components/media/useProbe';
import { Kbd } from '@/components/ui/badges';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/components/ui/cn';
import { EvidenceRail } from './library/EvidenceRail';
import { recordsPeople } from './library/model';
import { VIEW_INFO, posterUrl, stageUrl, underlayUrl, type StillView } from './library/renditions';
import { useLibrarySequence } from './library/sequence';
import { useInsight } from './hooks';
import { useConsoleActions, useConsoleData, useConsoleRoute, useConsoleUi, type View } from './store';

/**
 * The Inspector: a full-height evidence view. Opening an asset from the
 * Library morphs its frame (shared `media-<id>` layoutId, media only) onto a
 * media-first stage, while the structured evidence record slides in beside it.
 * Escape closes, ← / → step through the Library's current results in their
 * on-screen order, focus is trapped inside and returned to the tile on close.
 * The open record lives in the URL (#library/<id>), so Back closes it and a
 * link reopens it; the store owns that history (inspect / closeInspector).
 * While Ask is open over it, the Inspector ignores the keyboard entirely.
 */

const EASE = [0.16, 1, 0.3, 1] as const;
const MORPH = { duration: 0.46, ease: EASE };
const NO_IDS: readonly string[] = [];

const VIEW_NAME: Record<View, string> = {
  overview: 'Overview',
  library: 'Library',
  incidents: 'Incidents',
  studio: 'Studio',
  reports: 'Reports',
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';

/** Widgets that own the arrow keys (a radio group moves its selection, a slider its value, a tab list its tab). */
const COMPOSITE =
  '[role=radiogroup],[role=radio],[role=slider],[role=tablist],[role=tab],[role=listbox],[role=option],[role=menu],[role=menubar],[role=menuitem],[role=grid],[role=tree]';

function tileFor(id: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>(`[data-asset-id="${CSS.escape(id)}"]`);
}

export function Inspector() {
  const { inspectId, paletteOpen } = useConsoleUi();
  const { getAsset } = useConsoleData();
  const asset = getAsset(inspectId);
  return <AnimatePresence>{asset && <InspectorShell key="inspector" asset={asset} paletteOpen={paletteOpen} />}</AnimatePresence>;
}

function InspectorShell({ asset, paletteOpen }: { asset: MediaAsset; paletteOpen: boolean }) {
  const { route } = useConsoleRoute();
  const { inspect, closeInspector } = useConsoleActions();
  const sequence = useLibrarySequence();
  const ids = route.view === 'library' ? sequence : NO_IDS;
  const index = ids.indexOf(asset.id);
  const canStep = index >= 0 && ids.length > 1;
  // The frame morphs only for the asset that was opened from a visible tile; stepping crossfades.
  const [originId, setOriginId] = useState<string | null>(() => (tileFor(asset.id) ? asset.id : null));
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // User close (Esc, ✕, breadcrumb): steps Back over the entry the Inspector pushed, so Forward reopens it.
  const close = useCallback(() => {
    if (originId !== asset.id) tileFor(asset.id)?.scrollIntoView({ block: 'nearest' });
    closeInspector();
  }, [asset.id, closeInspector, originId]);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!canStep) return;
      setOriginId(null);
      inspect(ids[(index + dir + ids.length) % ids.length]);
    },
    [canStep, ids, index, inspect],
  );

  // Latest handlers for the document listener, mutated in place so the mount effect can read them.
  const live = useRef({ close, step, assetId: asset.id, paletteOpen });
  useEffect(() => {
    live.current.close = close;
    live.current.step = step;
    live.current.assetId = asset.id;
    live.current.paletteOpen = paletteOpen;
  });

  useEffect(() => {
    const handlers = live.current;
    const root = rootRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const { body } = document;
    // Only the overflow lock: html reserves the scrollbar gutter (scrollbar-gutter: stable), so nothing shifts
    // sideways and there is no layout to read here.
    const savedOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    let raf = requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));

    const onKey = (event: KeyboardEvent) => {
      // Ask (or any other modal) open on top owns the keyboard: no Tab trapping, no stepping, no Esc here.
      if (handlers.paletteOpen) return;
      const target = event.target instanceof Element ? event.target : null;
      if (root && target && !root.contains(target) && target.closest('[aria-modal="true"]')) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        handlers.close();
        return;
      }
      const tag = target?.tagName;
      const editing =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'VIDEO' || (target instanceof HTMLElement && target.isContentEditable);
      // Arrows inside a radio group, slider or tab list belong to that widget (Segmented also marks them handled).
      const composite = Boolean(target?.closest(COMPOSITE));
      if (
        (event.key === 'ArrowRight' || event.key === 'ArrowLeft') &&
        !editing &&
        !composite &&
        !event.defaultPrevented &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        const dir = event.key === 'ArrowRight' ? 1 : -1;
        const hadFocus = Boolean(root?.contains(document.activeElement));
        handlers.step(dir);
        // Stepping re-keys the record body: if the focused control was inside it, focus fell to <body>.
        // Put it on the stepper button for this direction (or Close), so the next arrow keeps working.
        if (hadFocus) {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            if (!root || root.contains(document.activeElement)) return;
            const fallback = (dir === 1 ? nextRef.current : prevRef.current) ?? closeRef.current;
            fallback?.focus({ preventScroll: true });
          });
        }
        return;
      }
      if (event.key !== 'Tab' || !root) return;
      const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      body.style.overflow = savedOverflow;
      const tile = tileFor(handlers.assetId);
      if (!tile) {
        opener?.focus({ preventScroll: true });
        return;
      }
      tile.focus({ preventScroll: true });
      // Closing steps Back, and the browser restores that entry's scroll, which can leave the record the viewer
      // stepped to off-screen. One read, once, at unmount: bring the focused tile into view if it is out of it.
      const r = tile.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= window.innerHeight) tile.scrollIntoView({ block: 'center' });
    };
  }, []);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 overflow-y-auto overflow-x-hidden overscroll-contain lg:overflow-hidden"
    >
      <motion.div
        aria-hidden
        className="fixed inset-0 bg-canvas"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.3, delay: 0.06, ease: EASE } }}
        transition={{ duration: 0.26, ease: EASE }}
      />
      <div className="relative flex min-h-full flex-col lg:h-full">
        <motion.header
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.14 } }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas px-3 sm:px-5"
        >
          <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-2 text-[12.5px]">
            <button type="button" onClick={close} className="link-underline shrink-0 text-ink-3 hover:text-ink">
              {VIEW_NAME[route.view]}
            </button>
            <span aria-hidden className="text-line-strong">
              /
            </span>
            <span className="shrink-0 font-mono text-[12px] tracking-[0.02em] text-ink">{asset.finding?.id ?? 'Capture'}</span>
            <span aria-hidden className="hidden text-line-strong sm:inline">
              /
            </span>
            <span className="hidden min-w-0 truncate font-mono text-[12px] text-ink-3 sm:inline">{asset.fileName}</span>
          </nav>
          {canStep && (
            <div className="flex items-center gap-1">
              <span className="num mr-1.5 hidden font-mono text-[11px] text-ink-3 sm:inline">
                {index + 1} / {ids.length}
              </span>
              <button ref={prevRef} type="button" onClick={() => step(-1)} className="btn btn-ghost btn-sm btn-icon" aria-label="Previous capture" title="Previous (←)">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button ref={nextRef} type="button" onClick={() => step(1)} className="btn btn-ghost btn-sm btn-icon" aria-label="Next capture" title="Next (→)">
                <ChevronRight className="h-4 w-4" />
              </button>
              <span aria-hidden className="mx-1.5 h-5 w-px bg-line" />
            </div>
          )}
          <button ref={closeRef} type="button" onClick={close} className="btn btn-ghost btn-sm gap-2 pr-2" aria-label="Close inspector">
            <Kbd className="hidden sm:inline-flex">Esc</Kbd>
            <X className="h-4 w-4" />
          </button>
        </motion.header>

        <InspectorBody key={asset.id} asset={asset} morph={originId === asset.id} titleId={titleId} />
      </div>
    </div>
  );
}

function InspectorBody({ asset, morph, titleId }: { asset: MediaAsset; morph: boolean; titleId: string }) {
  const [view, setView] = useState<StillView>('original');
  const [showAnnotation, setShowAnnotation] = useState(true);
  const [showFocus, setShowFocus] = useState(false);
  const [showFaces, setShowFaces] = useState(true);
  const [duration, setDuration] = useState<number | undefined>(asset.duration);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setVideoReady(Boolean(node));
  }, []);

  const { insight, error: insightError } = useInsight(asset);
  const isVideo = asset.resourceType === 'video';
  const finding = asset.finding;
  const url = stageUrl(asset, view);
  const delivery = useProbe(url, { accept: isVideo ? undefined : IMAGE_ACCEPT });
  const ratio = asset.width / Math.max(1, asset.height);
  // Cloudinary's automatic detections (can include objects, can miss people): labelled as detections, not faces.
  const faces = useMemo(() => (insight?.faces ?? []).map((f) => ({ ...f, label: 'FACE DETECTION' })), [insight]);
  const crop = useMemo(() => (insight?.focus ? { ...insight.focus, label: `${insight.focus.label ?? CROP_LABEL} · 1:1` } : undefined), [insight]);
  const frameWidth = `min(100%, calc(var(--stage-h) * ${ratio.toFixed(4)}))`;
  const renditionOptions = (Object.keys(VIEW_INFO) as StillView[]).map((v) => ({
    value: v,
    label: VIEW_INFO[v].label,
    title:
      v === 'redacted' && insight && insight.faces.length === 0
        ? 'e_pixelate_faces: Cloudinary detected no faces in this frame, so nothing is pixelated'
        : VIEW_INFO[v].title,
  }));

  return (
    <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
      {/* Stage */}
      <section
        aria-label="Media"
        className={cn(
          'relative z-10 flex min-w-0 flex-col lg:flex-1',
          // Height budget for the frame: viewport minus top bar, stage toolbar, padding, footer (and keyframes for video).
          isVideo ? '[--stage-h:44dvh] lg:[--stage-h:calc(100dvh_-_320px)]' : '[--stage-h:58dvh] lg:[--stage-h:calc(100dvh_-_196px)]',
        )}
      >
        {/* Quiet survey texture: a light table for the frame. Static, never animated. */}
        <span
          aria-hidden
          className="survey-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_72%)]"
        />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.14 } }}
          transition={{ duration: 0.3, delay: 0.14 }}
          className="relative flex min-h-12 flex-wrap items-center justify-between gap-2 px-3 pt-3 sm:px-6"
        >
          {isVideo ? (
            <span className="label">Playback · transcoded by Cloudinary</span>
          ) : (
            <Segmented
              size="sm"
              ariaLabel="Rendition"
              value={view}
              onChange={setView}
              options={renditionOptions}
            />
          )}
          {!isVideo && (
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Overlays">
              {finding?.region && (
                <Toggle
                  on={showAnnotation}
                  onChange={setShowAnnotation}
                  label={asset.source === 'sample' ? 'Sample annotation' : 'Annotation'}
                  tone="annotation"
                  disabled={view === 'redacted'}
                />
              )}
              <Toggle on={showFocus} onChange={setShowFocus} label={CROP_LABEL} tone="live" disabled={!insight?.focus} />
              {faces.length > 0 && (
                <Toggle
                  on={showFaces}
                  onChange={setShowFaces}
                  label={`Face detections · ${faces.length}`}
                  tone="live"
                  disabled={view === 'redacted'}
                />
              )}
            </div>
          )}
        </motion.div>

        <div className="relative flex flex-1 items-center justify-center px-3 py-4 sm:px-6 lg:min-h-0">
          <motion.div
            layoutId={morph ? `media-${asset.id}` : undefined}
            transition={{ layout: MORPH }}
            className="relative overflow-hidden"
            style={{ aspectRatio: `${asset.width} / ${asset.height}`, width: frameWidth, borderRadius: 6 }}
          >
            <motion.div
              initial={morph ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.26, ease: EASE }}
              className={cn('absolute inset-0', isVideo ? 'bg-black' : 'checker')}
            >
              {/* Small Cloudinary rendition, usually prefetched on hover: the frame is never empty while the stage rendition loads. */}
              <CloudImage
                src={underlayUrl(asset)}
                alt=""
                aria-hidden
                loading="eager"
                fetchPriority="high"
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover"
              />
              {isVideo ? (
                // Transparent player backdrop, so the prefetched frame shows until the stream is ready.
                <div className="absolute inset-0 [&>div]:bg-transparent">
                  <ProbedVideo url={url} poster={posterUrl(asset)} videoRef={attachVideo} onDuration={setDuration} />
                </div>
              ) : (
                <>
                  <ProbedImage url={url} alt={asset.title} fit="cover" />
                  {showAnnotation && finding?.region && view !== 'redacted' && <RegionLayer regions={[finding.region]} variant="annotation" />}
                  {showFocus && crop && <RegionLayer regions={[crop]} variant="focus" />}
                  {showFaces && view !== 'redacted' && faces.length > 0 && (
                    // Labels only where the frame is wide enough for them not to collide; the toggle names the boxes.
                    <RegionLayer regions={faces} variant="face" className="max-sm:[&_span]:hidden" />
                  )}
                  <span className="reticle" />
                  {view === 'redacted' && <RedactionStatus asset={asset} insight={insight} failed={Boolean(insightError)} />}
                </>
              )}
            </motion.div>
            <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[6px] border border-line" />
          </motion.div>
        </div>

        {isVideo && (
          <Keyframes asset={asset} duration={duration} width={frameWidth} videoRef={videoRef} videoReady={videoReady} />
        )}

        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.14 } }}
          transition={{ duration: 0.3, delay: 0.18 }}
          className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line bg-canvas px-3 py-3 sm:px-6"
        >
          <span className="num min-w-0 truncate font-mono text-[11px] text-ink-3">
            {asset.fileName} · {asset.width}×{asset.height} · {asset.format.toUpperCase()} · {formatBytes(asset.bytes)}
            {isVideo && duration ? ` · ${formatDuration(duration)}` : ''}
          </span>
          <span className="flex items-center gap-2">
            <span className="label">Delivered by Cloudinary</span>
            <DeliveryReceipt result={delivery} compact />
          </span>
        </motion.footer>
      </section>

      <EvidenceRail
        asset={asset}
        view={view}
        url={url}
        delivery={delivery}
        insight={insight}
        insightError={insightError}
        focusOn={showFocus}
        onToggleFocus={() => setShowFocus((v) => !v)}
        onShowRedacted={isVideo ? undefined : () => setView('redacted')}
        titleId={titleId}
      />
    </div>
  );
}

/**
 * What the Faces redacted rendition actually did, from Cloudinary's own face
 * detections: e_pixelate_faces pixelates only what Cloudinary detects, so with
 * zero detections the frame is unchanged and must be reviewed by a person.
 */
function RedactionStatus({ asset, insight, failed }: { asset: MediaAsset; insight: CloudinaryInsight | undefined; failed: boolean }) {
  let tone: 'muted' | 'warn' | 'signal' = 'muted';
  let text: string;
  if (insight) {
    const n = insight.faces.length;
    if (n === 0) {
      tone = 'warn';
      text = recordsPeople(asset)
        ? 'No faces detected — people in frame are not pixelated · review manually'
        : 'No faces detected — nothing pixelated · review manually';
    } else {
      tone = 'signal';
      text = `e_pixelate_faces · ${n} face detection${n === 1 ? '' : 's'} pixelated · check the result`;
    }
  } else {
    text = failed ? 'Face detections unavailable — review manually before sharing' : 'Checking Cloudinary face detections…';
  }
  const Icon = tone === 'warn' ? TriangleAlert : ScanFace;
  return (
    <span
      role="status"
      className={cn(
        'pointer-events-none absolute bottom-3 left-1/2 z-10 inline-flex w-max max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-1.5 rounded-[6px] border bg-canvas/90 px-2 py-1 font-mono text-[11px] leading-snug',
        tone === 'warn'
          ? 'border-[color-mix(in_oklab,var(--color-warn)_55%,transparent)] text-warn'
          : tone === 'signal'
            ? 'border-[color-mix(in_oklab,var(--color-signal)_40%,transparent)] text-ink'
            : 'border-line text-ink-3',
      )}
    >
      <Icon aria-hidden className={cn('h-3.5 w-3.5 shrink-0', tone === 'signal' && 'text-signal')} />
      <span className="min-w-0">{text}</span>
    </span>
  );
}

/** Cloudinary keyframes (so_) under the player; the current one follows playback at half-second resolution. */
function Keyframes({
  asset,
  duration,
  width,
  videoRef,
  videoReady,
}: {
  asset: MediaAsset;
  duration: number | undefined;
  width: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  videoReady: boolean;
}) {
  const [playhead, setPlayhead] = useState<number | undefined>(undefined);
  useEffect(() => {
    const video = videoRef.current;
    if (!videoReady || !video) return;
    const onTime = () => {
      const t = Math.round(video.currentTime * 2) / 2;
      setPlayhead((prev) => (prev === t ? prev : t));
    };
    video.addEventListener('timeupdate', onTime);
    return () => video.removeEventListener('timeupdate', onTime);
  }, [videoRef, videoReady]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.14 } }}
      transition={{ duration: 0.3, delay: 0.2 }}
      className="relative px-3 pb-4 sm:px-6"
    >
      <div className="mx-auto" style={{ width: `min(${width}, 760px)` }}>
        <div className="mb-2 flex items-center justify-between">
          <span className="label">Keyframes · extracted by Cloudinary (so_)</span>
          {duration ? <span className="num font-mono text-[11px] text-ink-3">{duration.toFixed(1)} s</span> : null}
        </div>
        <FrameStrip
          asset={asset}
          duration={duration}
          activeTime={playhead}
          onSeek={(t) => {
            const video = videoRef.current;
            if (!video) return;
            video.currentTime = t;
            void video.play().catch(() => undefined);
          }}
        />
      </div>
    </motion.div>
  );
}

function Toggle({
  on,
  onChange,
  label,
  tone,
  disabled = false,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  tone: 'annotation' | 'live';
  disabled?: boolean;
}) {
  const active = on && !disabled;
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-[6px] border px-2 font-mono text-[10.5px] uppercase tracking-[0.04em] transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'border-line-strong bg-raised text-ink' : 'border-line text-ink-3 hover:text-ink-2',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', active ? (tone === 'live' ? 'bg-signal' : 'bg-high') : 'bg-line-strong')} />
      {label}
    </button>
  );
}
