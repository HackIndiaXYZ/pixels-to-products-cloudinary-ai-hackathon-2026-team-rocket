'use client';

import { ArrowRight, CheckCircle2, ChevronDown, CloudUpload, Loader2, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Category, MediaAsset, ResourceType, Severity } from '@/lib/types';
import { CATEGORIES, CATEGORY_LABEL, SEVERITIES, sitesOf } from '@/lib/analytics';
import { canUpload, DEMO_CLOUD } from '@/lib/cloudinary/config';
import { listByTag, toMediaAsset, uploadFile, type IngestMetadata, type ListedResource } from '@/lib/cloudinary/upload';
import { formatBytes, titleCase } from '@/lib/format';
import { Dialog } from '@/components/ui/Dialog';
import { cn } from '@/components/ui/cn';
import { useConsoleActions, useConsoleData, useConsoleUi } from './store';

/**
 * Tags on Cloudinary's public demo cloud whose resource lists return real operational images
 * (checked against res.cloudinary.com/demo/image/list/<tag>.json: fleet trucks, bridge
 * structures, rail). The demo cloud is shared by every Cloudinary example, so its *video* tags
 * are dominated by unrelated uploads; on demo, Sync reads images only.
 */
const DEMO_SYNC_TAGS = ['truck', 'bridge', 'train'] as const;
/** A free-typed demo tag can match hundreds of public images; keep the newest ones. */
const DEMO_SYNC_LIMIT = 48;

interface QueueItem {
  id: string;
  file: File;
  progress: number;
  status: 'queued' | 'uploading' | 'done' | 'error';
  message?: string;
  asset?: MediaAsset;
}

type SyncState =
  | { state: 'idle' }
  | { state: 'running'; tag: string }
  | { state: 'done'; message: string; firstId?: string }
  | { state: 'error'; message: string };

export function IngestSheet() {
  const { ingestOpen, setIngestOpen } = useConsoleUi();
  const { settings } = useConsoleData();
  const demo = settings.cloudName === DEMO_CLOUD;
  const uploads = canUpload(settings);
  return (
    <Dialog
      open={ingestOpen}
      onClose={() => setIngestOpen(false)}
      title="Ingest field media"
      description={
        uploads
          ? 'Upload straight into your Cloudinary cloud, or sync what is already there by tag.'
          : demo
            ? 'Bring real media into the library from Cloudinary’s public demo cloud.'
            : 'Sync what is already in your Cloudinary cloud by tag. Uploading needs an unsigned upload preset.'
      }
      className="max-w-[760px]"
    >
      <IngestBody />
    </Dialog>
  );
}

function IngestBody() {
  const { settings } = useConsoleData();
  // Without an upload preset the working path is Sync, so it comes first and upload setup folds away.
  if (!canUpload(settings)) {
    return (
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <SyncSection primary />
        <UploadSetup />
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
      <UploadSection />
      <div className="border-t border-line pt-5">
        <SyncSection />
      </div>
    </div>
  );
}

// ---- upload -----------------------------------------------------------------

function UploadSection() {
  const { settings, addUserAssets, assets } = useConsoleData();
  const { setIngestOpen, inspect, navigate } = useConsoleActions();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const sites = sitesOf(assets);
  const [meta, setMeta] = useState<IngestMetadata>({ title: '', site: sites[0] ?? 'Building B', category: 'structural', severity: undefined, note: '' });

  const addFiles = (files: FileList | File[]) => {
    const accepted = Array.from(files).filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    setQueue((prev) => [
      ...prev,
      ...accepted.map((file) => ({ id: `${file.name}-${file.size}-${file.lastModified}`, file, progress: 0, status: 'queued' as const })),
    ]);
  };

  const patch = (id: string, p: Partial<QueueItem>) => setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...p } : q)));

  const uploadAll = async () => {
    for (const item of queue.filter((q) => q.status === 'queued' || q.status === 'error')) {
      patch(item.id, { status: 'uploading', progress: 0, message: undefined });
      try {
        const res = await uploadFile(item.file, {
          cloudName: settings.cloudName,
          uploadPreset: settings.uploadPreset,
          tags: [settings.tag, meta.category, meta.site.toLowerCase().replace(/\s+/g, '-')],
          metadata: { ...meta, title: meta.title || item.file.name.replace(/\.[^.]+$/, '') },
          onProgress: (p) => patch(item.id, { progress: p }),
        });
        if (res.resource_type !== 'image' && res.resource_type !== 'video') throw new Error(`Unsupported resource type ${res.resource_type}`);
        const asset = toMediaAsset({
          cloudName: settings.cloudName,
          publicId: res.public_id,
          resourceType: res.resource_type,
          format: res.format,
          width: res.width,
          height: res.height,
          bytes: res.bytes,
          duration: res.duration,
          createdAt: res.created_at,
          fileName: res.original_filename,
          tags: res.tags,
          context: res.context?.custom ?? {
            title: meta.title || item.file.name,
            site: meta.site,
            category: meta.category,
            ...(meta.severity ? { severity: meta.severity } : {}),
            ...(meta.note ? { note: meta.note } : {}),
          },
          source: 'upload',
        });
        addUserAssets([asset]);
        patch(item.id, { status: 'done', progress: 1, asset });
      } catch (error) {
        patch(item.id, { status: 'error', message: (error as Error).message });
      }
    }
  };

  const done = queue.filter((q) => q.status === 'done');

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13.5px] font-semibold">Upload to Cloudinary</h3>
        <span className="truncate font-mono text-[11px] text-ink-3">
          {settings.cloudName} · preset {settings.uploadPreset}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 sm:col-span-2">
          <span className="text-[12px] text-ink-2">Title (optional — defaults to the file name)</span>
          <input className="input" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} maxLength={120} />
        </label>
        <label className="space-y-1">
          <span className="text-[12px] text-ink-2">Site</span>
          <input className="input" list="ingest-sites" value={meta.site} onChange={(e) => setMeta({ ...meta, site: e.target.value })} maxLength={60} />
          <datalist id="ingest-sites">
            {sites.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className="space-y-1">
          <span className="text-[12px] text-ink-2">Category</span>
          <select className="input" value={meta.category} onChange={(e) => setMeta({ ...meta, category: e.target.value as Category })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[12px] text-ink-2">Severity (leave empty if no issue)</span>
          <select
            className="input"
            value={meta.severity ?? ''}
            onChange={(e) => setMeta({ ...meta, severity: (e.target.value || undefined) as Severity | undefined })}
          >
            <option value="">No finding</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[12px] text-ink-2">Observation</span>
          <input className="input" value={meta.note} onChange={(e) => setMeta({ ...meta, note: e.target.value })} maxLength={200} />
        </label>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed px-4 py-8 text-center transition-colors',
          dragging ? 'border-signal bg-[color-mix(in_oklab,var(--color-signal)_6%,transparent)]' : 'border-line-strong',
        )}
      >
        <CloudUpload className="h-6 w-6 text-ink-3" />
        <p className="text-[13px] text-ink-2">Drop photos or videos here</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => inputRef.current?.click()}>
          Choose files
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <p className="text-[11.5px] text-ink-3">
          Tags <span className="font-mono">{settings.tag}</span>, category and site go to Cloudinary as tags and context metadata.
        </p>
      </div>

      {queue.length > 0 && (
        <ul className="divide-y divide-line rounded-[10px] border border-line">
          {queue.map((q) => (
            <li key={q.id} className="flex items-center gap-3 px-3 py-2.5 text-[12.5px]">
              {q.status === 'done' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-signal" />
              ) : q.status === 'error' ? (
                <TriangleAlert className="h-4 w-4 shrink-0 text-critical" />
              ) : q.status === 'uploading' ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-2" />
              ) : (
                <span className="h-4 w-4 shrink-0 rounded-full border border-line-strong" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{q.file.name}</span>
                {q.status === 'error' && <span className="block font-mono text-[11px] text-critical">Cloudinary: {q.message}</span>}
                {q.status === 'uploading' && (
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-raised">
                    <span
                      className="block h-full origin-left bg-signal transition-transform"
                      style={{ transform: `scaleX(${Math.max(0, Math.min(1, q.progress))})` }}
                    />
                  </span>
                )}
                {q.status === 'done' && q.asset && (
                  <span className="block truncate font-mono text-[11px] text-ink-3">
                    public_id {q.asset.publicId} · {q.asset.format.toUpperCase()} {formatBytes(q.asset.bytes)}
                  </span>
                )}
              </span>
              <span className="num shrink-0 font-mono text-[11px] text-ink-3">{formatBytes(q.file.size)}</span>
              {q.status === 'queued' && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-icon"
                  aria-label={`Remove ${q.file.name}`}
                  onClick={() => setQueue((prev) => prev.filter((x) => x.id !== q.id))}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {done.length > 0 && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setIngestOpen(false);
              navigate('library');
              // Its own history entry on top of #library, so Back (or Esc) closes the record and stays in the library.
              if (done[0].asset) inspect(done[0].asset.id);
            }}
          >
            View {done.length} in library
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!queue.some((q) => q.status === 'queued' || q.status === 'error') || queue.some((q) => q.status === 'uploading')}
          onClick={uploadAll}
        >
          <CloudUpload className="h-3.5 w-3.5" /> Upload {queue.filter((q) => q.status === 'queued' || q.status === 'error').length || ''}
        </button>
      </div>
    </section>
  );
}

/** Upload needs a cloud of your own; folded under Sync so the sheet leads with what works now. */
function UploadSetup() {
  const { settings } = useConsoleData();
  const { setSettingsOpen } = useConsoleActions();
  return (
    <details className="group rounded-[10px] border border-line bg-raised">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-[10px] px-4 py-3 [&::-webkit-details-marker]:hidden">
        <CloudUpload className="h-4 w-4 shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-ink">Upload from this browser</span>
          <span className="block text-[12px] text-ink-3">Two public values: your cloud name and an unsigned upload preset</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-3 transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="border-t border-line px-4 py-3.5 text-[13px] leading-relaxed text-ink-2">
        <p>
          Uploads go to your own Cloudinary cloud through an <span className="font-medium text-ink">unsigned upload preset</span> — no API secret is ever
          used. Set <code className="break-all font-mono text-[12px] text-ink">NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME</code> and{' '}
          <code className="break-all font-mono text-[12px] text-ink">NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET</code> in <code className="font-mono text-[12px]">.env.local</code>,
          or enter them for this browser.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSettingsOpen(true)}>
            Configure Cloudinary
          </button>
          <span className="font-mono text-[11px] text-ink-3">
            now: {settings.cloudName} · {settings.uploadPreset ? `preset ${settings.uploadPreset}` : 'no preset'}
          </span>
        </div>
      </div>
    </details>
  );
}

// ---- sync -------------------------------------------------------------------

const assetKey = (cloudName: string, type: ResourceType, publicId: string) => `${cloudName}/${type}/${publicId}`;

function SyncSection({ primary = false }: { primary?: boolean }) {
  const { settings, addUserAssets, assets } = useConsoleData();
  const { setIngestOpen, navigate, inspect } = useConsoleActions();
  const cloud = settings.cloudName;
  const demo = cloud === DEMO_CLOUD;
  const [syncTag, setSyncTag] = useState<string>(() => (demo ? DEMO_SYNC_TAGS[0] : settings.tag));
  const [sync, setSync] = useState<SyncState>({ state: 'idle' });
  const running = sync.state === 'running';
  const noun = demo ? 'images' : 'assets';

  const runSync = async () => {
    const tag = syncTag;
    setSync({ state: 'running', tag });
    try {
      const types: ResourceType[] = demo ? ['image'] : ['image', 'video'];
      const lists = await Promise.all(
        types.map(async (type) => (await listByTag(cloud, tag, type)).map((r: ListedResource) => ({ r, type }))),
      );
      const found = lists.flat();
      // The bundled samples (and anything uploaded here) already live in the library under their own ids.
      const known = new Set(assets.filter((a) => a.source !== 'sync').map((a) => assetKey(a.cloudName, a.resourceType, a.publicId)));
      const fresh = found
        .filter(({ r, type }) => !known.has(assetKey(cloud, type, r.public_id)))
        .sort((a, b) => Date.parse(b.r.created_at ?? '') - Date.parse(a.r.created_at ?? '') || 0);
      const kept = demo ? fresh.slice(0, DEMO_SYNC_LIMIT) : fresh;
      const skipped = found.length - fresh.length;
      const more = fresh.length - kept.length;

      const synced = kept.map(({ r, type }) =>
        toMediaAsset({
          cloudName: cloud,
          publicId: r.public_id,
          resourceType: type,
          format: r.format,
          width: r.width,
          height: r.height,
          createdAt: r.created_at,
          context: r.context?.custom,
          tags: [tag],
          source: 'sync',
        }),
      );
      if (synced.length) addUserAssets(synced);

      const where = demo ? 'the sample dataset' : 'the library';
      let message: string;
      if (!found.length) message = `Nothing on ${cloud} carries the tag “${tag}”${demo ? ' as an image' : ''}.`;
      else if (!synced.length) message = `Everything tagged “${tag}” on ${cloud} is already in ${where}.`;
      else {
        message = `${synced.length} ${synced.length === 1 ? noun.slice(0, -1) : noun} tagged “${tag}” on ${cloud} ${synced.length === 1 ? 'is' : 'are'} now in the library.`;
        if (more) message += ` These are the ${synced.length} newest; ${more} more carry the tag.`;
        if (skipped) message += ` ${skipped} already in ${where} ${skipped === 1 ? 'was' : 'were'} skipped.`;
      }
      setSync({ state: 'done', message, firstId: synced[0]?.id });
    } catch (error) {
      setSync({ state: 'error', message: (error as Error).message });
    }
  };

  return (
    <section>
      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[13.5px] font-semibold">Sync from Cloudinary</h3>
          <span className="truncate font-mono text-[11px] text-ink-3">
            {cloud} · {demo ? 'images' : 'images + videos'}
          </span>
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
          {demo ? (
            <>
              Demo cloud: sync real tagged images from Cloudinary through its client-side resource list, no credentials needed. Uploading needs your own
              cloud and an unsigned upload preset.
            </>
          ) : (
            <>
              Reads every image and video tagged <span className="font-mono text-ink-2">{syncTag || '…'}</span> on{' '}
              <span className="font-mono text-ink-2">{cloud}</span> through Cloudinary’s client-side resource list, including the context metadata
              written at upload. No credentials needed; the cloud must allow resource lists.
            </>
          )}
        </p>
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (syncTag && !running) void runSync();
        }}
      >
        <input
          className="input font-mono"
          value={syncTag}
          onChange={(e) => setSyncTag(e.target.value.trim())}
          aria-label="Cloudinary tag"
          maxLength={60}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <button
          type="submit"
          className={cn('btn shrink-0', primary ? 'btn-primary' : 'btn-secondary')}
          disabled={!syncTag || running}
          data-autofocus={primary || undefined}
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Sync
        </button>
      </form>

      {demo && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="label mr-1">Tags on demo</span>
          {DEMO_SYNC_TAGS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={syncTag === t}
              onClick={() => setSyncTag(t)}
              className={cn(
                'inline-flex h-7 items-center rounded-[6px] border px-2.5 font-mono text-[12px] transition-colors pointer-coarse:h-9 pointer-coarse:px-3',
                syncTag === t ? 'border-line-strong bg-raised text-ink' : 'border-line text-ink-2 hover:bg-raised hover:text-ink',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Always mounted so screen readers announce the result; it takes no space while empty. */}
      <div role="status" aria-live="polite">
        {sync.state === 'running' && (
          <p className="mt-3 text-[12.5px] text-ink-3">
            Reading the “{sync.tag}” resource list on {cloud}…
          </p>
        )}
        {(sync.state === 'done' || sync.state === 'error') && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className={cn('min-w-0 flex-1 basis-[280px] text-[12.5px] leading-relaxed', sync.state === 'error' ? 'text-critical' : 'text-ink-2')}>
              {sync.state === 'error' ? 'Cloudinary: ' : ''}
              {sync.message}
            </p>
            {sync.state === 'done' && sync.firstId && (
              <button
                type="button"
                className="btn btn-secondary btn-sm shrink-0"
                onClick={() => {
                  setIngestOpen(false);
                  navigate('library');
                  // Synced captures keep their Cloudinary dates, so they sort below the samples; show the newest one.
                  if (sync.firstId) inspect(sync.firstId);
                }}
              >
                View in library <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
