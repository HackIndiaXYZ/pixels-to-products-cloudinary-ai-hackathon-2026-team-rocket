'use client';

import { motion } from 'framer-motion';
import { Download, ExternalLink, FileText, Loader2, LockKeyhole, ScanFace, ShieldCheck, Sparkles, Trash2, TriangleAlert, Wand2 } from 'lucide-react';
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { AiUnderstanding, AssetSource, FindingStatus, MediaAsset } from '@/lib/types';
import { CROP_LABEL, describeCropCentre, type CloudinaryInsight } from '@/lib/cloudinary/insights';
import type { ProbeResult } from '@/lib/cloudinary/probe';
import { CATEGORY_LABEL, captureBasisOf } from '@/lib/analytics';
import { analyzeAsset, untagAsset } from '@/lib/cloudinary/backend';
import { downloadOriginalUrl, originalUrl } from '@/lib/cloudinary/media';
import { PRESETS, presetSteps } from '@/lib/cloudinary/pipeline';
import { withAiUnderstanding } from '@/lib/cloudinary/upload';
import { formatBytes, formatDateTime, formatDuration, relativeTime } from '@/lib/format';
import { CloudImage } from '@/components/media/CloudImage';
import { DeliveryReceipt } from '@/components/media/DeliveryReceipt';
import { IntegrityBadge, LiveDot, SEVERITY_COLOR, SeverityDot, StatusBadge } from '@/components/ui/badges';
import { CopyButton } from '@/components/ui/CopyButton';
import { ProvenanceBadge } from '@/components/ui/Provenance';
import { cn } from '@/components/ui/cn';
import { applyRecordRemoval, applyRecordUpdate, isTeamCloudRecord } from '../cloud-records';
import { humanProvenanceDetail } from '../incidents/model';
import { useConsoleActions, useConsoleData, type ConsoleData } from '../store';
import { recordsPeople } from './model';
import {
  VIEW_INFO,
  aiObjectGroups,
  aiObjectRegions,
  describeComponent,
  renditionComponents,
  renditionExtension,
  underlayUrl,
  type StillView,
} from './renditions';

const EASE = [0.16, 1, 0.3, 1] as const;

const STATUS_NOTE: Record<FindingStatus, string> = {
  open: 'Action outstanding on this finding.',
  monitoring: 'Under observation; re-inspect on the next round.',
  resolved: 'Closed out. Kept as the record.',
};

const SOURCE_NOTE: Record<AssetSource, string> = {
  sample: 'Sample dataset · Cloudinary demo cloud',
  upload: 'Uploaded to Cloudinary from this browser',
  sync: 'Synced from a Cloudinary tag',
};

/** Records read from the team's cloud (Search API): the same sources, stored in Cloudinary rather than this browser. */
const TEAM_SOURCE_NOTE: Record<AssetSource, string> = {
  sample: 'Sample workspace · stored in your Cloudinary cloud',
  upload: 'Entered at ingest · stored in your Cloudinary cloud',
  sync: 'Tagged in your Cloudinary cloud',
};

/** Who wrote the record tags. None of them are detected by Cloudinary (auto-tags are listed under Cloudinary AI). */
const TAG_SOURCE: Record<AssetSource, string> = {
  sample: 'sample annotation',
  upload: 'entered at ingest',
  sync: 'Cloudinary asset tags',
};

/** Keeps the latest console data in a ref, for work that finishes after the render that started it. */
function useLatest(data: ConsoleData) {
  const ref = useRef(data);
  useEffect(() => {
    ref.current = data;
  });
  return ref;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The Integrity note for the rendition on screen; the redacted one depends on what Cloudinary actually detected. */
function integrityNote(asset: MediaAsset, view: StillView, insight: CloudinaryInsight | undefined): string {
  if (asset.resourceType === 'video') return 'Resized and transcoded for playback only. No content is generated.';
  if (view !== 'redacted' || !insight) return VIEW_INFO[view].integrity;
  if (insight.faces.length === 0) return 'Cloudinary detected no faces, so nothing is pixelated. Review the frame manually before sharing.';
  return `Pixelates what Cloudinary detects as faces (${plural(insight.faces.length, 'detection')}). Detections can include objects and miss people. No content is generated.`;
}

/**
 * The structured evidence record beside the Inspector stage: the finding and
 * the recommended action first, then identity, place and time, the record's
 * own tags (written by people, labelled with who wrote them), what Cloudinary
 * AI understood (caption, objects, auto-tags — stored on the asset), what
 * Cloudinary detects live (fl_getinfo faces and crop), the exact transformation
 * chain of the rendition on screen, Cloudinary's delivery receipt, integrity
 * and audit. Every block carries its provenance: AI detected, Human classified
 * or System derived.
 */
export function EvidenceRail({
  asset,
  view,
  url,
  delivery,
  insight,
  insightError,
  focusOn,
  onToggleFocus,
  onShowRedacted,
  ai = asset.ai,
  aiOn = false,
  onToggleAi,
  onAnalyzed,
  titleId,
}: {
  asset: MediaAsset;
  view: StillView;
  url: string;
  delivery: ProbeResult | undefined;
  insight?: CloudinaryInsight;
  insightError?: string;
  focusOn: boolean;
  onToggleFocus: () => void;
  /** Switches the stage to the Faces redacted rendition (stills only). */
  onShowRedacted?: () => void;
  /** Cloudinary AI understanding to show (the record's, or one just fetched). */
  ai?: AiUnderstanding;
  /** Whether the AI object boxes are drawn on the stage. */
  aiOn?: boolean;
  /** Shows / hides the AI object boxes on the stage (absent when there are none to draw). */
  onToggleAi?: () => void;
  /** Called with a fresh result after "Analyze with Cloudinary AI". */
  onAnalyzed?: (ai: AiUnderstanding) => void;
  titleId: string;
}) {
  const data = useConsoleData();
  const { now, backend } = data;
  const { inspect, openInStudio, reportFor, removeUserAsset } = useConsoleActions();
  const finding = asset.finding;
  const isVideo = asset.resourceType === 'video';
  const components = renditionComponents(url, asset);
  const extension = renditionExtension(url);
  const facePreset = PRESETS.find((p) => p.id === 'privacy-redaction');
  const studioPreset = PRESETS.find((p) => p.id === (isVideo ? 'field-clip' : 'evidence-enhance'));
  const accent = finding ? SEVERITY_COLOR[finding.severity] : 'var(--color-line-strong)';
  const basis = captureBasisOf(asset);
  const noFaces = insight?.faces.length === 0;
  const inTeamCloud = isTeamCloudRecord(asset, backend);
  // Bundled samples on the demo cloud stay; anything in the team's cloud or only in this browser can go.
  const removable = inTeamCloud || asset.source !== 'sample';

  return (
    <motion.aside
      aria-labelledby={titleId}
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12, transition: { duration: 0.16, ease: EASE } }}
      transition={{ duration: 0.44, delay: 0.08, ease: EASE }}
      className="relative flex w-full shrink-0 flex-col border-t border-line bg-surface lg:min-h-0 lg:w-[440px] lg:border-l lg:border-t-0 xl:w-[480px]"
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-[2px]" style={{ backgroundColor: accent }} />
      <div className="flex-1 lg:overflow-y-auto lg:overscroll-contain">
        {/* Identity */}
        <header className="px-6 pb-6 pt-7">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.08em]">
            {finding ? (
              <>
                <SeverityDot severity={finding.severity} />
                <span style={{ color: SEVERITY_COLOR[finding.severity] }}>{finding.severity}</span>
                <span className="text-ink-3">·</span>
                <span className="text-ink-2">{CATEGORY_LABEL[finding.category]}</span>
              </>
            ) : (
              <span className="text-ink-3">No finding recorded</span>
            )}
            <span className="text-ink-3">·</span>
            <span className="text-ink-3">{isVideo ? 'Video' : 'Photo'}</span>
          </div>
          <h2 id={titleId} className="type-heading mt-3 text-[26px] text-ink sm:text-[28px]">
            {finding?.title ?? asset.title}
          </h2>
        </header>

        {/* Finding: what is wrong and what to do, before the record's metadata. */}
        {finding && (
          <Section title="Finding" aside={<ProvenanceBadge kind="human" detail={humanProvenanceDetail(asset)} />}>
            <p className="text-[13.5px] leading-relaxed text-ink-2">{finding.summary}</p>
            <div className="mt-4 border-l-2 pl-4" style={{ borderColor: accent }}>
              <div className="label">Recommended action</div>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink">{finding.action}</p>
            </div>
          </Section>
        )}

        <Ledger
          title="Record"
          aside={<ProvenanceBadge kind="human" detail={humanProvenanceDetail(asset)} />}
          rows={[
            {
              label: 'Inspection ID',
              value: finding ? (
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-[12.5px] tracking-[0.02em]">{finding.id}</span>
                  <CopyButton value={finding.id} label="Copy inspection ID" iconOnly className="h-6 w-6 border-transparent bg-transparent text-ink-3 hover:text-ink" />
                </span>
              ) : (
                <span className="text-ink-3">—</span>
              ),
            },
            {
              label: 'Location',
              value: (
                <>
                  {asset.site}
                  {asset.zone && <span className="block text-[12px] text-ink-3">{asset.zone}</span>}
                </>
              ),
            },
            {
              label: 'Captured',
              value:
                basis === 'fixed' && asset.cameraTime ? (
                  // Show the camera's own clock exactly as burned into the footage; its time zone is unknown.
                  <>
                    <span className="num font-mono text-[12.5px]">{asset.cameraTime}</span>
                    <span className="block text-[11.5px] text-ink-3">Camera time · burned into the footage</span>
                  </>
                ) : basis === 'sample-relative' ? (
                  <>
                    <span className="num">{formatDateTime(asset.capturedAt)}</span>
                    <span className="num block text-[11.5px] text-ink-3">
                      Sample time · relative to now · {relativeTime(asset.capturedAt, now)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="num">{formatDateTime(asset.capturedAt)}</span>
                    <span className="num block font-mono text-[11px] text-ink-3">
                      {asset.capturedAt.replace(/\.\d{3}Z$/, 'Z')} · {relativeTime(asset.capturedAt, now)}
                    </span>
                    <span className="block text-[11.5px] text-ink-3">Upload time recorded by Cloudinary</span>
                  </>
                ),
            },
            { label: 'Captured by', value: asset.capturedBy },
            {
              label: 'Source',
              value: <span className="text-ink-2">{(inTeamCloud ? TEAM_SOURCE_NOTE : SOURCE_NOTE)[asset.source]}</span>,
            },
            {
              label: 'Media',
              value: (
                <span className="num font-mono text-[11.5px] text-ink-2">
                  {asset.fileName}
                  <span className="block text-ink-3">
                    {asset.format.toUpperCase()} · {asset.width}×{asset.height} · {formatBytes(asset.bytes)}
                    {isVideo && asset.duration ? ` · ${formatDuration(asset.duration)}` : ''}
                  </span>
                </span>
              ),
            },
          ]}
        />

        {/* Record tags: written by people, so labelled with who wrote them, never as detections. */}
        {asset.tags.length > 0 && (
          <Section title="Record tags" aside={<ProvenanceBadge kind="human" detail={TAG_SOURCE[asset.source]} />}>
            <ul aria-label="Record tags" className="flex flex-wrap gap-1.5">
              {asset.tags.map((t) => (
                <li key={t} className="rounded-[5px] border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                  {t}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Cloudinary AI Content Analysis, stored on the asset (or the way to run it). */}
        <AiSection asset={asset} ai={ai} aiOn={aiOn} onToggleAi={onToggleAi} onAnalyzed={onAnalyzed} inTeamCloud={inTeamCloud} />

        {/* Live Cloudinary signals (fl_getinfo) and nothing else. */}
        <Section
          title="Faces & crop · Cloudinary"
          aside={
            <span className="flex items-center gap-2">
              <span className="flex items-center gap-1.5">
                <LiveDot /> live
              </span>
              <ProvenanceBadge kind="ai" detail="fl_getinfo" />
            </span>
          }
        >
          <div className="flex items-start gap-4">
            <SignalMap asset={asset} insight={insight} active={focusOn} onToggle={onToggleFocus} interactive={!isVideo} />
            {insight ? (
              <dl className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
                <dt className="text-ink-3">{CROP_LABEL} (1:1)</dt>
                <dd className="num text-right font-mono text-[11.5px] text-ink">{insight.focus ? describeCropCentre(insight.focus) : 'not reported'}</dd>
                <dt className="text-ink-3">Face detections</dt>
                <dd className="num text-right font-mono text-[11.5px] text-ink">{insight.faces.length}</dd>
                <dt className="text-ink-3">Analysed</dt>
                <dd className="num text-right font-mono text-[11.5px] text-ink-2">
                  {insight.inputWidth}×{insight.inputHeight}
                  {isVideo ? ` @ ${asset.posterOffset ?? 1} s` : ''}
                </dd>
                <dd className="col-span-2 pt-1 text-right">
                  <a
                    href={insight.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-3 hover:text-ink"
                  >
                    fl_getinfo JSON <ExternalLink className="h-3 w-3" />
                  </a>
                </dd>
              </dl>
            ) : (
              <p className="flex-1 text-[12.5px] text-ink-3">{insightError ? `Unavailable: ${insightError}` : 'Asking Cloudinary…'}</p>
            )}
          </div>
          {insight && (
            <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
              The crop window&apos;s size follows the requested 1:1 ratio; only where g_auto placed it reflects the content. Face detections are
              automatic and can include objects or miss people.
            </p>
          )}
          {insight && insight.faces.length > 0 && (
            <Notice tone="signal">
              {isVideo ? (
                <>
                  Cloudinary detected {plural(insight.faces.length, 'possible face')} in the frame analysed at{' '}
                  <span className="num">{asset.posterOffset ?? 1}</span> s — see the {insight.faces.length === 1 ? 'box' : 'boxes'} on the
                  thumbnail. VisualOps redacts faces in stills only, so review this clip before sharing it outside the team.
                </>
              ) : (
                <>
                  Cloudinary detected {plural(insight.faces.length, 'possible face')} — check the {insight.faces.length === 1 ? 'box' : 'boxes'}{' '}
                  (Face detections overlay) before sharing.
                  {onShowRedacted && view !== 'redacted' && (
                    <button type="button" onClick={onShowRedacted} className="link-underline ml-1 text-ink hover:text-signal">
                      View Faces redacted
                    </button>
                  )}
                </>
              )}
            </Notice>
          )}
          {noFaces && recordsPeople(asset) && (
            <Notice tone="warn">
              No faces detected, but people are recorded in frame — face redaction will not hide them. Review manually before sharing.
            </Notice>
          )}
        </Section>

        {/* Transformations */}
        <Section title="Transformations" aside={isVideo ? 'Playback rendition' : VIEW_INFO[view].label}>
          <ol className="overflow-hidden rounded-[8px] border border-line bg-canvas">
            {components.map((c, i) => (
              <li key={`${i}-${c}`} className="flex items-baseline gap-3 border-b border-line px-3 py-2 last:border-b-0">
                <span className="num w-3 shrink-0 font-mono text-[10px] text-ink-3">{i + 1}</span>
                <code className="shrink-0 font-mono text-[12px] text-ink">{c}</code>
                <span className="ml-auto min-w-0 truncate text-right text-[11.5px] text-ink-3">{describeComponent(c)}</span>
              </li>
            ))}
            {extension && (
              <li className="flex items-baseline gap-3 px-3 py-2">
                <span className="w-3 shrink-0" />
                <code className="shrink-0 font-mono text-[12px] text-ink">.{extension}</code>
                <span className="ml-auto min-w-0 truncate text-right text-[11.5px] text-ink-3">
                  {isVideo ? `${extension.toUpperCase()} container` : 'output format'}
                </span>
              </li>
            )}
          </ol>
          <div className="mt-2.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-3" title={url}>
              {url.replace(/^https:\/\//, '')}
            </code>
            <CopyButton value={url} label="Copy URL" />
          </div>
        </Section>

        {/* Delivery: measured by VisualOps from Cloudinary's response headers. */}
        <div className="relative border-t border-line px-6 py-5">
          <ProvenanceBadge kind="system" detail="measured" className="absolute right-6 top-[18px]" />
          <DeliveryReceipt result={delivery} label="Cloudinary delivery" className="[&>.label]:pr-48" />
        </div>

        {/* Integrity + audit */}
        <div className="grid grid-cols-2 border-t border-line">
          <div className="border-r border-line px-6 py-5">
            <h3 className="label">Integrity</h3>
            <div className="mt-3">
              <IntegrityBadge integrity="evidence" />
            </div>
            <p className={cn('mt-2 text-[12px] leading-relaxed', view === 'redacted' && noFaces && !isVideo ? 'text-warn' : 'text-ink-3')}>
              {integrityNote(asset, view, insight)}
            </p>
          </div>
          <div className="px-6 py-5">
            <h3 className="label">Audit status</h3>
            <div className="mt-3">{finding ? <StatusBadge status={finding.status} /> : <span className="chip bg-transparent">No finding</span>}</div>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-3">{finding ? STATUS_NOTE[finding.status] : 'Nothing to action for this capture.'}</p>
          </div>
        </div>

        {/* Asset */}
        <Section title="Cloudinary asset" aside={<span className="font-mono normal-case tracking-normal">{asset.resourceType}/upload</span>}>
          <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[11.5px]">
            <dt className="text-ink-3">cloud</dt>
            <dd className="text-ink">{asset.cloudName}</dd>
            <dt className="text-ink-3">public_id</dt>
            <dd className="break-all text-ink">{asset.publicId}</dd>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <a className="btn btn-secondary btn-sm" href={originalUrl(asset)} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" /> Original
            </a>
            <a className="btn btn-secondary btn-sm" href={downloadOriginalUrl(asset)}>
              <Download className="h-3.5 w-3.5" /> Download
            </a>
          </div>
        </Section>
      </div>

      {/* Actions */}
      <footer className="sticky bottom-0 z-10 space-y-2 border-t border-line bg-surface px-6 py-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => openInStudio(asset.id, studioPreset ? presetSteps(studioPreset) : undefined)}
          >
            <Wand2 className="h-4 w-4" /> Open in Studio
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              reportFor([asset.id], 'inspection');
              // Close at once (urgent) while the Reports view mounts in a transition.
              inspect(null);
            }}
          >
            <FileText className="h-4 w-4" /> Report
          </button>
        </div>
        {(!isVideo || removable) && (
          <div className="flex flex-wrap gap-2">
            {!isVideo && facePreset && (
              <button
                type="button"
                className="btn btn-ghost btn-sm flex-1"
                onClick={() => openInStudio(asset.id, presetSteps(facePreset))}
                title={
                  noFaces
                    ? 'Cloudinary detected no faces in this frame, so face pixelation would change nothing.'
                    : 'Open Studio with face pixelation (e_pixelate_faces) on Cloudinary’s detections.'
                }
              >
                <ShieldCheck className="h-3.5 w-3.5" /> Redact for sharing
                {noFaces && <span className="font-normal text-ink-3">· 0 faces detected</span>}
              </button>
            )}
            {inTeamCloud && asset.source === 'sample' ? (
              // Team-seeded sample records are protected on the server (DELETE /api/assets/[id]); say so up front.
              <span
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[12px] text-ink-3"
                title="The shared workspace keeps its team-seeded sample records. Records you ingest can be removed."
              >
                <LockKeyhole className="h-3.5 w-3.5" aria-hidden /> Sample record · protected
              </span>
            ) : inTeamCloud ? (
              <RemoveFromVisualOps asset={asset} onRemoved={() => inspect(null)} />
            ) : (
              asset.source !== 'sample' && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm flex-1 text-ink-3"
                  onClick={() => {
                    removeUserAsset(asset.id);
                    inspect(null);
                  }}
                  title="Removes it from this browser. The asset stays in Cloudinary."
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove from this browser
                </button>
              )
            )}
          </div>
        )}
      </footer>
    </motion.aside>
  );
}

type AnalyzeState = { status: 'idle' } | { status: 'running' } | { status: 'error'; message: string };

/**
 * What Cloudinary AI understood about the frame (AI Content Analysis: captioning + coco object detection
 * with auto-tagging), stored on the asset's contextual metadata by POST /api/assets/[id]/analyze. For an
 * image in the team's cloud that has not been analysed yet, the way to run it.
 */
function AiSection({
  asset,
  ai,
  aiOn,
  onToggleAi,
  onAnalyzed,
  inTeamCloud,
}: {
  asset: MediaAsset;
  ai: AiUnderstanding | undefined;
  aiOn: boolean;
  onToggleAi?: () => void;
  onAnalyzed?: (ai: AiUnderstanding) => void;
  inTeamCloud: boolean;
}) {
  const data = useConsoleData();
  const latest = useLatest(data);
  const { now, backend } = data;
  const [state, setState] = useState<AnalyzeState>({ status: 'idle' });
  const [warning, setWarning] = useState<string | undefined>(undefined);
  const errorId = useId();
  const isVideo = asset.resourceType === 'video';

  const analyze = async () => {
    setState({ status: 'running' });
    setWarning(undefined);
    try {
      const result = await analyzeAsset(asset.publicId, 'image');
      onAnalyzed?.(result.ai);
      setWarning(result.warning);
      // The record in place: Cloudinary now holds ai_* in the asset's context, and the tags auto-tagging added.
      applyRecordUpdate(latest.current, withAiUnderstanding(asset, result.ai, result.tags, backend?.tag));
      setState({ status: 'idle' });
    } catch (error) {
      setState({ status: 'error', message: (error as Error).message });
    }
  };

  const badge = <ProvenanceBadge kind="ai" detail="Cloudinary" />;

  if (!ai) {
    let note: string | undefined;
    if (isVideo) note = 'AI analysis runs on images; this video keeps its face and crop signals (fl_getinfo on the poster frame, below).';
    else if (!backend?.configured) note = 'Cloudinary AI analysis runs through the VisualOps server connected to your Cloudinary cloud. It is not connected here.';
    else if (!inTeamCloud)
      note =
        asset.source === 'sample'
          ? 'Bundled sample on Cloudinary’s demo cloud. Cloudinary AI analysis runs on records in your team’s cloud.'
          : 'This record is not in your team’s Cloudinary cloud, so Cloudinary AI cannot analyse it from here.';
    const canAnalyze = !note;
    return (
      <Section title="Detected by Cloudinary AI" aside={badge}>
        {canAnalyze ? (
          <>
            <p className="text-[12.5px] leading-relaxed text-ink-3">
              Not analysed yet. Cloudinary AI captions the frame and detects objects (coco, with auto-tagging), and the result is stored on
              the asset’s own context metadata. Uses 2 Cloudinary AI detections.
            </p>
            <button
              type="button"
              className="btn btn-secondary btn-sm mt-3"
              disabled={state.status === 'running'}
              onClick={() => void analyze()}
              aria-describedby={state.status === 'error' ? errorId : undefined}
            >
              {state.status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-signal" />}
              {state.status === 'running' ? 'Understanding with Cloudinary AI…' : state.status === 'error' ? 'Try again' : 'Analyze with Cloudinary AI'}
            </button>
            <div role="status" aria-live="polite">
              {state.status === 'error' && (
                <Notice tone="warn" id={errorId}>
                  Cloudinary AI analysis failed: {state.message}
                </Notice>
              )}
            </div>
          </>
        ) : (
          <p className="text-[12.5px] leading-relaxed text-ink-3">{note}</p>
        )}
      </Section>
    );
  }

  const groups = aiObjectGroups(ai);
  const boxes = aiObjectRegions(ai).length;
  return (
    <Section title="Detected by Cloudinary AI" aside={badge}>
      <div role="status" aria-live="polite">
        {ai.caption ? (
          <p className="text-[14px] leading-relaxed text-ink">“{ai.caption}”</p>
        ) : (
          <p className="text-[12.5px] text-ink-3">Cloudinary AI returned no caption for this frame.</p>
        )}
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h4 className="label">Objects · coco</h4>
          {onToggleAi && boxes > 0 && !isVideo && (
            <button
              type="button"
              aria-pressed={aiOn}
              onClick={onToggleAi}
              className={cn(
                'inline-flex h-6 items-center gap-1.5 rounded-[5px] border px-1.5 font-mono text-[10.5px] uppercase tracking-[0.04em] transition-colors',
                aiOn ? 'border-line-strong bg-raised text-ink' : 'border-line text-ink-3 hover:text-ink-2',
              )}
            >
              <span aria-hidden className={cn('h-2 w-2 rounded-[1px] border-[1.5px]', aiOn ? 'border-signal' : 'border-line-strong')} />
              Boxes on frame · {boxes}
            </button>
          )}
        </div>
        {groups.length > 0 ? (
          <ul aria-label="Objects detected by Cloudinary AI" className="space-y-1.5">
            {groups.map((g) => (
              <li key={g.label} className="grid grid-cols-[minmax(0,1fr)_72px_40px] items-center gap-3 text-[12.5px]">
                <span className="min-w-0 truncate text-ink">
                  {g.label}
                  {g.count > 1 && <span className="num text-ink-3"> ×{g.count}</span>}
                </span>
                <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-raised">
                  <span className="block h-full origin-left bg-signal" style={{ transform: `scaleX(${Math.max(0, Math.min(1, g.confidence))})` }} />
                </span>
                <span className="num text-right font-mono text-[11.5px] text-ink-2" title="Cloudinary's confidence">
                  {Math.round(g.confidence * 100)}%
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-3">No objects detected above the confidence threshold.</p>
        )}
      </div>

      {ai.tags.length > 0 && (
        <div className="mt-4">
          <h4 className="label mb-2">Auto-tags added to the asset</h4>
          <ul aria-label="Tags added by Cloudinary auto-tagging" className="flex flex-wrap gap-1.5">
            {ai.tags.map((t) => (
              <li
                key={t}
                className="rounded-[5px] border border-[color-mix(in_oklab,var(--color-signal)_35%,transparent)] px-1.5 py-0.5 font-mono text-[11px] text-ink-2"
              >
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}

      <dl className="mt-4 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[11px]">
        <dt className="text-ink-3">model</dt>
        <dd className="min-w-0 text-ink-2">{ai.model ?? 'Cloudinary AI Content Analysis'}</dd>
        {ai.analyzedAt && (
          <>
            <dt className="text-ink-3">analysed</dt>
            <dd className="num min-w-0 text-ink-2">
              {formatDateTime(ai.analyzedAt)} · {relativeTime(ai.analyzedAt, now)}
            </dd>
          </>
        )}
      </dl>
      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
        Machine-generated by Cloudinary and stored on the asset. Confidence is Cloudinary’s own; the finding above is the human record.
      </p>
      {warning && <Notice tone="warn">{warning}</Notice>}
    </Section>
  );
}

/**
 * Takes a team-cloud record out of the VisualOps workspace after a confirm step: the server removes the
 * VisualOps tag from the asset (DELETE /api/assets/[id]). Non-destructive — the media stays in Cloudinary.
 */
function RemoveFromVisualOps({ asset, onRemoved }: { asset: MediaAsset; onRemoved: () => void }) {
  const data = useConsoleData();
  const latest = useLatest(data);
  const tag = data.backend?.tag ?? 'visualops';
  const [step, setStep] = useState<{ status: 'idle' | 'confirm' | 'running' } | { status: 'error'; message: string }>({ status: 'idle' });
  const confirmRef = useRef<HTMLButtonElement>(null);
  const confirming = step.status !== 'idle';

  useEffect(() => {
    if (step.status === 'confirm') confirmRef.current?.focus({ preventScroll: true });
  }, [step.status]);

  const remove = async () => {
    setStep({ status: 'running' });
    try {
      await untagAsset(asset.publicId, asset.resourceType);
      applyRecordRemoval(latest.current, asset.id);
      onRemoved();
    } catch (error) {
      setStep({ status: 'error', message: (error as Error).message });
    }
  };

  if (!confirming) {
    return (
      <button
        type="button"
        className="btn btn-ghost btn-sm flex-1 text-ink-3"
        onClick={() => setStep({ status: 'confirm' })}
        title={`Removes the “${tag}” tag so the record leaves VisualOps. The media stays in Cloudinary.`}
      >
        <Trash2 className="h-3.5 w-3.5" /> Remove from VisualOps
      </button>
    );
  }
  return (
    <div role="group" aria-label="Remove from VisualOps" className="basis-full rounded-[8px] border border-line-strong bg-raised px-3 py-2.5">
      <p className="text-[12.5px] leading-relaxed text-ink-2">
        Remove this record from VisualOps? The <span className="font-mono text-ink">{tag}</span> tag is removed from the asset, so it leaves the
        workspace on every device. The media, its other tags and its metadata stay in your Cloudinary cloud.
      </p>
      {step.status === 'error' && (
        <p role="alert" className="mt-2 text-[12px] text-critical">
          {step.message}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button ref={confirmRef} type="button" className="btn btn-secondary btn-sm" disabled={step.status === 'running'} onClick={() => void remove()}>
          {step.status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          {step.status === 'error' ? 'Try again' : 'Remove from VisualOps'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={step.status === 'running'} onClick={() => setStep({ status: 'idle' })}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Notice({ tone, id, children }: { tone: 'signal' | 'warn'; id?: string; children: ReactNode }) {
  const Icon = tone === 'warn' ? TriangleAlert : ScanFace;
  return (
    <p
      id={id}
      className={cn(
        'mt-4 flex items-start gap-2 rounded-[8px] border px-3 py-2 text-[12px] leading-relaxed text-ink-2',
        tone === 'warn'
          ? 'border-[color-mix(in_oklab,var(--color-warn)_45%,transparent)]'
          : 'border-[color-mix(in_oklab,var(--color-signal)_30%,transparent)]',
      )}
    >
      <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', tone === 'warn' ? 'text-warn' : 'text-signal')} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-line px-6 py-5">
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <h3 className="label">{title}</h3>
        {aside && <span className="font-mono text-[10.5px] text-ink-3">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Ledger({ rows, title, aside }: { rows: Array<{ label: string; value: ReactNode }>; title?: string; aside?: ReactNode }) {
  return (
    <div className="border-t border-line px-6 py-4">
      {(title || aside) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          {title && <h3 className="label">{title}</h3>}
          {aside}
        </div>
      )}
      <dl className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-4 text-[13px] leading-snug">
        {rows.map((row) => (
          <Fragment key={row.label}>
            <dt className="py-1.5 text-[12px] text-ink-3">{row.label}</dt>
            <dd className="min-w-0 py-1.5 text-ink">{row.value}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

/**
 * Where Cloudinary placed its g_auto crop and the faces it detected, drawn over
 * a small copy of the analysed frame. Pressing it toggles the crop on the stage.
 */
function SignalMap({
  asset,
  insight,
  active,
  onToggle,
  interactive,
}: {
  asset: MediaAsset;
  insight?: CloudinaryInsight;
  active: boolean;
  onToggle: () => void;
  interactive: boolean;
}) {
  const ratio = insight ? insight.inputWidth / Math.max(1, insight.inputHeight) : asset.width / Math.max(1, asset.height);
  const width = ratio >= 1 ? 128 : Math.max(56, Math.round(128 * ratio));
  const content = (
    <>
      <CloudImage src={underlayUrl(asset)} alt="" loading="eager" className="absolute inset-0 h-full w-full object-cover opacity-35" />
      {insight?.focus && (
        <span
          className={cn('absolute border border-dashed transition-colors', active ? 'border-signal bg-signal/15' : 'border-signal/80')}
          style={{ left: `${insight.focus.x}%`, top: `${insight.focus.y}%`, width: `${insight.focus.w}%`, height: `${insight.focus.h}%` }}
        />
      )}
      {insight?.faces.map((f, i) => (
        <span
          key={i}
          className="absolute border border-signal bg-signal/25"
          style={{ left: `${f.x}%`, top: `${f.y}%`, width: `${f.w}%`, height: `${f.h}%` }}
        />
      ))}
    </>
  );
  const className = 'relative block shrink-0 overflow-hidden rounded-[6px] border bg-canvas';
  const style = { width, aspectRatio: `${ratio}` };
  if (!interactive || !insight?.focus) {
    return (
      <span aria-hidden className={cn(className, 'border-line')} style={style}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      title={active ? 'Hide the g_auto crop on the stage' : 'Show the g_auto crop on the stage'}
      className={cn(className, 'transition-colors', active ? 'border-signal' : 'border-line-strong hover:border-ink-3')}
      style={style}
    >
      <span className="sr-only">Show Cloudinary&apos;s g_auto crop on the stage</span>
      {content}
    </button>
  );
}
