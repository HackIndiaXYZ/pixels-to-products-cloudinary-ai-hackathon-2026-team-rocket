'use client';

import { Code2, Download, ExternalLink, Film, RotateCcw } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { MediaAsset } from '@/lib/types';
import { DEMO_CLOUD } from '@/lib/cloudinary/config';
import { displayUrl, originalUrl, refOf, thumbUrl } from '@/lib/cloudinary/media';
import {
  INTEGRITY_HELP,
  PRESETS,
  aspect as parseAspect,
  defaultPresetFor,
  framingUrl,
  hasFraming,
  pipelineAligned,
  pipelineComponents,
  pipelineExtension,
  pipelineIntegrity,
  pipelineIsAsync,
  pipelineUrl,
  presetSteps,
  type PipelinePreset,
  type PipelineStep,
} from '@/lib/cloudinary/pipeline';
import { IMAGE_ACCEPT } from '@/lib/cloudinary/probe';
import { attachmentComponents, deliveryUrl } from '@/lib/cloudinary/url';
import { CompareViewer, type CompareMode } from '@/components/media/CompareViewer';
import { VideoCompare } from '@/components/media/VideoCompare';
import { DeliveryReceipt } from '@/components/media/DeliveryReceipt';
import { CloudImage } from '@/components/media/CloudImage';
import { useProbe } from '@/components/media/useProbe';
import { IntegrityBadge } from '@/components/ui/badges';
import { CopyButton } from '@/components/ui/CopyButton';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/components/ui/cn';
import { useConsoleActions, useConsoleData, useConsoleRoute, useConsoleUi } from '../store';
import { ViewHeader } from './ViewHeader';
import { PipelineEditor } from '../studio/PipelineEditor';
import { GenerativePanel } from '../studio/GenerativePanel';
import { CodeExportDialog } from '../studio/CodeExportDialog';
import { PipelineMachine } from '../studio/PipelineMachine';
import { useMediaQuery } from '../studio/machine/useMediaQuery';

type Panel = 'pipeline' | 'generative' | 'presets';

function ratio(value: string | number | boolean | undefined): number | undefined {
  const a = parseAspect(value, '');
  if (!a) return undefined;
  const [w, h] = a.split(':').map(Number);
  return w && h ? w / h : undefined;
}

/**
 * The Studio. Reads only what it renders from the console store (dataset, the
 * Studio route and stable actions), and is memoised, so opening Ask or the
 * Inspector over it does not re-render the pipeline, viewer or machine.
 */
export const StudioView = memo(function StudioView() {
  const { now, assets, backend, userAssets, updateCloudAsset, addUserAssets } = useConsoleData();
  const { studioAssetId, studioSteps, setStudioAsset, setStudioSteps } = useConsoleRoute();
  const { inspect, setExportOpen } = useConsoleActions();
  const asset = assets.find((a) => a.id === studioAssetId) ?? assets[0];
  const steps = studioSteps;
  const [panel, setPanel] = useState<Panel>('pipeline');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [modeByAsset, setModeByAsset] = useState<Record<string, CompareMode>>({});
  const narrow = useMediaQuery('(max-width: 639px)');

  const isVideo = asset.resourceType === 'video';
  const afterUrl = pipelineUrl(steps, asset, previewIndex ?? undefined);
  // The machine always runs the full pipeline; a new asset or pipeline URL resets it.
  const fullPipelineUrl = pipelineUrl(steps, asset);
  const aligned = pipelineAligned(steps, asset);
  const beforeUrl = isVideo ? originalUrl(asset) : framingUrl(steps, asset);
  const integrity = pipelineIntegrity(previewIndex === null ? steps : steps.slice(0, previewIndex + 1), asset);
  const generative = integrity === 'generative';
  // A generative result must be seen whole, not half-hidden under the original at the slider's rest
  // position: side by side (the output alone on phones) unless the user picked a mode for this asset.
  const mode = modeByAsset[asset.id] ?? (aligned && !generative ? 'slider' : narrow ? 'after' : 'side');

  const cropStep = steps.find((s) => s.enabled && s.kind === 'smart_crop');
  const fillStep = steps.find((s) => s.enabled && s.kind === 'gen_fill');
  const reframeStep = steps.find((s) => s.enabled && s.kind === 'smart_reframe');
  const outputAspect = ratio(fillStep?.params.aspect) ?? ratio(cropStep?.params.aspect) ?? asset.width / asset.height;

  const beforeResult = useProbe(beforeUrl, { accept: isVideo ? undefined : IMAGE_ACCEPT });
  const afterResult = useProbe(afterUrl, { accept: isVideo ? undefined : IMAGE_ACCEPT });
  const downloadUrl = deliveryUrl(
    refOf(asset),
    attachmentComponents(pipelineComponents(steps, asset, previewIndex ?? undefined), `${asset.fileName}-visualops`),
    pipelineExtension(asset),
  );

  const presets = PRESETS.filter((p) => p.resourceType === asset.resourceType);
  // The team's own cloud (not the demo cloud): the machine can run Cloudinary AI Content Analysis and a Search lookup.
  const team = Boolean(backend?.configured && backend.cloudName && asset.cloudName === backend.cloudName && asset.cloudName !== DEMO_CLOUD);
  // New AI understanding goes straight into the record in place, and into this browser's cached copy when there is one.
  const onAnalysed = useCallback(
    (next: MediaAsset) => {
      updateCloudAsset(next);
      if (userAssets.some((a) => a.id === next.id)) addUserAssets([next]);
    },
    [updateCloudAsset, userAssets, addUserAssets],
  );

  const loadPreset = (preset: PipelinePreset) => {
    setStudioSteps(presetSteps(preset, asset));
    setPreviewIndex(null);
    setPanel('pipeline');
  };

  const selectAsset = (a: MediaAsset) => {
    setStudioAsset(a.id);
    setPreviewIndex(null);
  };

  return (
    <div className="space-y-5">
      <ViewHeader
        title="Studio"
        subtitle="Visual AI pipeline — every step is a Cloudinary transformation; what you see is the URL you export"
        actions={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => inspect(asset.id)}>
              Record
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setExportOpen(true)}>
              <Code2 className="h-3.5 w-3.5" /> Export code
            </button>
          </>
        }
      />

      <AssetPicker assets={assets} selectedId={asset.id} onSelect={selectAsset} />

      <PipelineMachine
        key={`${asset.id}|${fullPipelineUrl}`}
        asset={asset}
        steps={steps}
        assets={assets}
        now={now}
        team={team}
        onAnalysed={onAnalysed}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-mono text-[11.5px] text-ink-3">{asset.fileName}</div>
              <div className="truncate text-[15px] font-semibold tracking-[-0.01em]">{asset.finding?.title ?? asset.title}</div>
            </div>
            {previewIndex !== null && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreviewIndex(null)}>
                <RotateCcw className="h-3.5 w-3.5" /> Previewing to step {previewIndex + 1} — show full pipeline
              </button>
            )}
          </div>

          {isVideo ? (
            <VideoCompare
              beforeUrl={beforeUrl}
              afterUrl={afterUrl}
              poster={displayUrl(asset, 1280)}
              aspect={asset.width / asset.height}
              afterAspect={ratio(reframeStep?.params.aspect)}
              beforeLabel="Original (MP4 for playback)"
            />
          ) : (
            <CompareViewer
              key={asset.id}
              beforeUrl={beforeUrl}
              afterUrl={afterUrl}
              beforeLabel={aligned && hasFraming(steps) ? 'Original · same framing' : 'Original'}
              afterLabel={generative ? 'Output · AI-generated' : 'Cloudinary output'}
              aspect={outputAspect}
              mode={mode}
              onModeChange={(m) => setModeByAsset((prev) => ({ ...prev, [asset.id]: m }))}
              geometryNote={aligned ? undefined : 'Generative fill changes the canvas, so the slider cannot align pixels — side by side is clearer.'}
              components={pipelineComponents(steps, asset, previewIndex ?? undefined)}
              // Each generative result gets its own intro (full output → split); evidence-safe tweaks never re-sweep.
              introKey={generative ? `${asset.id}|${afterUrl}` : asset.id}
            />
          )}

          {/* Output */}
          <section className="panel space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <IntegrityBadge integrity={integrity} />
              <span className="text-[12.5px] text-ink-3">{INTEGRITY_HELP[integrity]}</span>
            </div>
            <div>
              <div className="label mb-1.5">Delivery URL</div>
              <div className="break-all rounded-[8px] border border-line bg-canvas px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-ink-2">
                {afterUrl}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <CopyButton value={afterUrl} label="Copy URL" />
                <a className="btn btn-secondary btn-sm" href={afterUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" /> Open
                </a>
                <a className="btn btn-secondary btn-sm" href={downloadUrl}>
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExportOpen(true)}>
                  <Code2 className="h-3.5 w-3.5" /> React · Node · Python · cURL · JSON
                </button>
              </div>
              {pipelineIsAsync(steps, asset) && (
                <p className="mt-2 text-[12px] text-ink-3">
                  This pipeline uses asynchronous AI video processing. Cloudinary answers HTTP 423 until the result is ready; VisualOps polls and shows it as soon as it is.
                </p>
              )}
            </div>
            <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
              <DeliveryReceipt result={beforeResult} label="Before · served by Cloudinary" />
              <DeliveryReceipt result={afterResult} label="After · served by Cloudinary" />
            </div>
          </section>
        </div>

        {/* Controls */}
        <aside className="panel h-fit min-w-0 xl:sticky xl:top-[68px]">
          <div className="border-b border-line p-2">
            <Segmented
              ariaLabel="Studio panel"
              value={panel}
              onChange={setPanel}
              className="w-full [&>button]:flex-1 [&>button]:justify-center"
              options={[
                { value: 'pipeline', label: `Pipeline · ${steps.length}` },
                { value: 'generative', label: 'Generative' },
                { value: 'presets', label: 'Presets' },
              ]}
            />
          </div>
          <div className="max-h-none p-3 xl:max-h-[calc(100vh-150px)] xl:overflow-y-auto">
            {panel === 'pipeline' && (
              <PipelineEditor
                asset={asset}
                steps={steps}
                onChange={(next) => {
                  setStudioSteps(next);
                  if (previewIndex !== null && previewIndex >= next.length) setPreviewIndex(null);
                }}
                previewIndex={previewIndex}
                onPreview={setPreviewIndex}
              />
            )}
            {panel === 'generative' && <GenerativePanel key={asset.id} asset={asset} steps={steps} onChange={setStudioSteps} />}
            {panel === 'presets' && (
              <ul className="space-y-1.5">
                {presets
                  .slice()
                  .sort((a, b) => Number(b.suggestedFor?.includes(asset.id) ?? false) - Number(a.suggestedFor?.includes(asset.id) ?? false))
                  .map((preset) => (
                    <li key={preset.id}>
                      <button
                        type="button"
                        onClick={() => loadPreset(preset)}
                        className="w-full rounded-[9px] border border-line px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-raised"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium">{preset.name}</span>
                          {preset.suggestedFor?.includes(asset.id) && <span className="chip text-signal">Suggested</span>}
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">{preset.description}</span>
                        <span className="mt-1.5 block truncate font-mono text-[10.5px] text-ink-3">
                          {preset.steps.map((s) => s.kind).join(' → ')}
                        </span>
                      </button>
                    </li>
                  ))}
                <li>
                  <button
                    type="button"
                    onClick={() => loadPreset(defaultPresetFor(asset))}
                    className="btn btn-ghost btn-sm w-full"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Reset to default
                  </button>
                </li>
              </ul>
            )}
          </div>
        </aside>
      </div>

      <StudioExport asset={asset} steps={steps} />
    </div>
  );
});

/** The export dialog is the only part of the Studio that follows the overlay state. */
function StudioExport({ asset, steps }: { asset: MediaAsset; steps: PipelineStep[] }) {
  const { exportOpen, setExportOpen } = useConsoleUi();
  return <CodeExportDialog open={exportOpen} onClose={() => setExportOpen(false)} asset={asset} steps={steps} />;
}

/** Edge fade widths (px) shown while the strip has more tiles off that side. */
const FADE_START = 20;
const FADE_END = 36;

/**
 * Every record in the workspace. At ≥1024 px the tiles wrap into rows that hold
 * all of them (slightly smaller tiles while the content column is narrow,
 * 1024–1279 px). Narrower, the strip scrolls sideways: edge fades mark the
 * hidden side, a vertical wheel scrolls it while it can move (then the page
 * takes over), and the selected tile is brought into view.
 */
function AssetPicker({
  assets,
  selectedId,
  onSelect,
}: {
  assets: MediaAsset[];
  selectedId: string;
  onSelect: (asset: MediaAsset) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);

  // Fades and wheel mapping. Scroll state goes straight to CSS variables: no React state per scroll frame.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    let shown = '';
    const sync = () => {
      const max = strip.scrollWidth - strip.clientWidth;
      const start = max > 1 && strip.scrollLeft > 1 ? FADE_START : 0;
      const end = max > 1 && strip.scrollLeft < max - 1 ? FADE_END : 0;
      const next = `${start}|${end}`;
      if (next === shown) return;
      shown = next;
      strip.style.setProperty('--fade-l', `${start}px`);
      strip.style.setProperty('--fade-r', `${end}px`);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = strip.scrollWidth - strip.clientWidth;
      if (max <= 1) return; // wrapped or fits: the page scrolls
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * strip.clientWidth : event.deltaY;
      const next = Math.min(max, Math.max(0, strip.scrollLeft + delta));
      if (Math.abs(next - strip.scrollLeft) < 0.5) return; // at the end: hand the wheel back to the page
      event.preventDefault();
      strip.scrollLeft = next;
    };
    sync();
    strip.addEventListener('scroll', sync, { passive: true });
    strip.addEventListener('wheel', onWheel, { passive: false });
    const ro = new ResizeObserver(sync);
    ro.observe(strip);
    return () => {
      strip.removeEventListener('scroll', sync);
      strip.removeEventListener('wheel', onWheel);
      ro.disconnect();
    };
  }, []);

  // A deep link or "Open in Studio" can select a tile that sits off the visible part of the strip.
  useEffect(() => {
    const strip = stripRef.current;
    const tile = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!strip || !tile || strip.scrollWidth - strip.clientWidth <= 1) return;
    const s = strip.getBoundingClientRect();
    const t = tile.getBoundingClientRect();
    if (t.left < s.left + FADE_START) strip.scrollLeft += t.left - s.left - FADE_START;
    else if (t.right > s.right - FADE_END) strip.scrollLeft += t.right - s.right + FADE_END;
  }, [selectedId]);

  const tile = (a: MediaAsset) => (
    <button
      key={a.id}
      type="button"
      onClick={() => onSelect(a)}
      aria-pressed={a.id === selectedId}
      title={`${a.fileName} — ${a.finding?.title ?? a.title}`}
      className={cn(
        'relative h-[58px] w-[92px] shrink-0 overflow-hidden rounded-[7px] border-2 transition-colors lg:h-[46px] lg:w-[72px] xl:h-[58px] xl:w-[92px]',
        a.id === selectedId ? 'border-signal' : 'border-transparent opacity-70 hover:opacity-100',
      )}
    >
      <CloudImage src={thumbUrl(a, 184, 116)} alt={a.title} className="h-full w-full object-cover" />
      {a.resourceType === 'video' && <Film aria-hidden className="absolute bottom-1 right-1 h-3 w-3 text-white drop-shadow" />}
    </button>
  );

  return (
    <div className="panel p-2">
      <div
        ref={stripRef}
        className="scrollbar-none -my-1 flex gap-1.5 overflow-x-auto py-1 [mask-image:linear-gradient(to_right,transparent,#000_var(--fade-l,0px),#000_calc(100%_-_var(--fade-r,0px)),transparent)] lg:flex-wrap lg:overflow-visible lg:[mask-image:none]"
      >
        {assets.map(tile)}
      </div>
    </div>
  );
}
