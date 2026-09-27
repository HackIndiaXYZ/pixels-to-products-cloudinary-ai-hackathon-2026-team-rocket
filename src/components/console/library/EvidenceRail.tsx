'use client';

import { motion } from 'framer-motion';
import { Download, ExternalLink, FileText, ScanFace, ShieldCheck, Trash2, TriangleAlert, Wand2 } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import type { AssetSource, FindingStatus, MediaAsset } from '@/lib/types';
import { CROP_LABEL, describeCropCentre, type CloudinaryInsight } from '@/lib/cloudinary/insights';
import type { ProbeResult } from '@/lib/cloudinary/probe';
import { CATEGORY_LABEL, captureBasisOf } from '@/lib/analytics';
import { downloadOriginalUrl, originalUrl } from '@/lib/cloudinary/media';
import { PRESETS, presetSteps } from '@/lib/cloudinary/pipeline';
import { formatBytes, formatDateTime, formatDuration, relativeTime } from '@/lib/format';
import { CloudImage } from '@/components/media/CloudImage';
import { DeliveryReceipt } from '@/components/media/DeliveryReceipt';
import { IntegrityBadge, LiveDot, SEVERITY_COLOR, SeverityDot, StatusBadge } from '@/components/ui/badges';
import { CopyButton } from '@/components/ui/CopyButton';
import { cn } from '@/components/ui/cn';
import { provenanceLabel } from '../incidents/model';
import { useConsoleActions, useConsoleData } from '../store';
import { recordsPeople } from './model';
import { VIEW_INFO, describeComponent, renditionComponents, renditionExtension, underlayUrl, type StillView } from './renditions';

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

/** Who wrote the record tags. None of them are detected by Cloudinary. */
const TAG_SOURCE: Record<AssetSource, string> = {
  sample: 'Sample annotation',
  upload: 'Entered at ingest',
  sync: 'Cloudinary asset tags',
};

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
 * detected live (fl_getinfo only), the exact transformation chain of the
 * rendition on screen, Cloudinary's delivery receipt, integrity and audit.
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
  titleId: string;
}) {
  const { now } = useConsoleData();
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
          <Section title="Finding" aside={provenanceLabel(asset)}>
            <p className="text-[13.5px] leading-relaxed text-ink-2">{finding.summary}</p>
            <div className="mt-4 border-l-2 pl-4" style={{ borderColor: accent }}>
              <div className="label">Recommended action</div>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink">{finding.action}</p>
            </div>
          </Section>
        )}

        <Ledger
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
                  </>
                ),
            },
            { label: 'Captured by', value: asset.capturedBy },
            { label: 'Source', value: <span className="text-ink-2">{SOURCE_NOTE[asset.source]}</span> },
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
          <Section title="Record tags" aside={TAG_SOURCE[asset.source]}>
            <ul aria-label="Record tags" className="flex flex-wrap gap-1.5">
              {asset.tags.map((t) => (
                <li key={t} className="rounded-[5px] border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                  {t}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Live Cloudinary signals (fl_getinfo) and nothing else. */}
        <Section
          title="Detected by Cloudinary"
          aside={
            <span className="flex items-center gap-1.5">
              <LiveDot /> fl_getinfo · live
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

        {/* Delivery */}
        <div className="border-t border-line px-6 py-5">
          <DeliveryReceipt result={delivery} label="Cloudinary delivery · measured from response headers" />
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
        {(!isVideo || asset.source !== 'sample') && (
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
            {asset.source !== 'sample' && (
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
            )}
          </div>
        )}
      </footer>
    </motion.aside>
  );
}

function Notice({ tone, children }: { tone: 'signal' | 'warn'; children: ReactNode }) {
  const Icon = tone === 'warn' ? TriangleAlert : ScanFace;
  return (
    <p
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

function Ledger({ rows }: { rows: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-4 border-t border-line px-6 py-4 text-[13px] leading-snug">
      {rows.map((row) => (
        <Fragment key={row.label}>
          <dt className="py-1.5 text-[12px] text-ink-3">{row.label}</dt>
          <dd className="min-w-0 py-1.5 text-ink">{row.value}</dd>
        </Fragment>
      ))}
    </dl>
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
