'use client';

import { Code2, Download, ExternalLink, Film, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import type { MediaAsset } from '@/lib/types';
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
import { useConsole } from '../store';
import { ViewHeader } from './ViewHeader';
import { PipelineEditor } from '../studio/PipelineEditor';
import { GenerativePanel } from '../studio/GenerativePanel';
import { CodeExportDialog } from '../studio/CodeExportDialog';

type Panel = 'pipeline' | 'generative' | 'presets';

function ratio(value: string | number | boolean | undefined): number | undefined {
  const a = parseAspect(value, '');
  if (!a) return undefined;
  const [w, h] = a.split(':').map(Number);
  return w && h ? w / h : undefined;
}

export function StudioView() {
  const { assets, studioAssetId, studioSteps, setStudioAsset, setStudioSteps, exportOpen, setExportOpen, inspect } = useConsole();
  const asset = assets.find((a) => a.id === studioAssetId) ?? assets[0];
  const steps = studioSteps;
  const [panel, setPanel] = useState<Panel>('pipeline');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [modeByAsset, setModeByAsset] = useState<Record<string, CompareMode>>({});

  const isVideo = asset.resourceType === 'video';
  const afterUrl = pipelineUrl(steps, asset, previewIndex ?? undefined);
  const aligned = pipelineAligned(steps, asset);
  const beforeUrl = isVideo ? originalUrl(asset) : framingUrl(steps, asset);
  const integrity = pipelineIntegrity(previewIndex === null ? steps : steps.slice(0, previewIndex + 1), asset);
  const mode = modeByAsset[asset.id] ?? (aligned ? 'slider' : 'side');

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

  const field = assets.filter((a) => a.collection !== 'reference');
  const reference = assets.filter((a) => a.collection === 'reference');
  const presets = PRESETS.filter((p) => p.resourceType === asset.resourceType);

  const loadPreset = (preset: PipelinePreset) => {
    setStudioSteps(presetSteps(preset));
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

      {/* Asset picker */}
      <div className="panel p-2">
        <div className="scrollbar-none flex gap-1.5 overflow-x-auto">
          {[...field, ...reference].map((a, i) => (
            <div key={a.id} className="flex shrink-0 items-stretch">
              {i === field.length && reference.length > 0 && (
                <span className="mx-1.5 flex items-center">
                  <span className="label [writing-mode:vertical-rl] rotate-180 text-[9.5px]">Samples</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => selectAsset(a)}
                aria-pressed={a.id === asset.id}
                title={`${a.fileName} — ${a.finding?.title ?? a.title}`}
                className={cn(
                  'relative h-[58px] w-[92px] overflow-hidden rounded-[7px] border-2 transition-colors',
                  a.id === asset.id ? 'border-signal' : 'border-transparent opacity-70 hover:opacity-100',
                )}
              >
                <CloudImage src={thumbUrl(a, 184, 116)} alt={a.title} className="h-full w-full object-cover" />
                {a.resourceType === 'video' && <Film className="absolute bottom-1 right-1 h-3 w-3 text-white drop-shadow" />}
              </button>
            </div>
          ))}
        </div>
      </div>

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
              afterLabel={integrity === 'generative' ? 'Output · AI-generated' : 'Cloudinary output'}
              aspect={outputAspect}
              mode={mode}
              onModeChange={(m) => setModeByAsset((prev) => ({ ...prev, [asset.id]: m }))}
              geometryNote={aligned ? undefined : 'Generative fill changes the canvas, so the slider cannot align pixels — side by side is clearer.'}
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
                          <span className="flex gap-1">
                            {preset.suggestedFor?.includes(asset.id) && <span className="chip text-signal">Suggested</span>}
                            {preset.audience === 'general' && <span className="chip">General</span>}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">{preset.description}</span>
                        <span className="mt-1.5 block truncate font-mono text-[10.5px] text-ink-3">
                          {presetSteps(preset)
                            .map((s) => s.kind)
                            .join(' → ')}
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

      <CodeExportDialog open={exportOpen} onClose={() => setExportOpen(false)} asset={asset} steps={steps} />
    </div>
  );
}

