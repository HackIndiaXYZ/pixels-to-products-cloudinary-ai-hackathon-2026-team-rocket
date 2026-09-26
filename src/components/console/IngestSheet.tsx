'use client';

import { CheckCircle2, CloudUpload, Loader2, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Category, MediaAsset, Severity } from '@/lib/types';
import { CATEGORIES, CATEGORY_LABEL, SEVERITIES, sitesOf } from '@/lib/analytics';
import { canUpload } from '@/lib/cloudinary/config';
import { listByTag, toMediaAsset, uploadFile, type IngestMetadata } from '@/lib/cloudinary/upload';
import { formatBytes, titleCase } from '@/lib/format';
import { Dialog } from '@/components/ui/Dialog';
import { cn } from '@/components/ui/cn';
import { useConsole } from './store';

interface QueueItem {
  id: string;
  file: File;
  progress: number;
  status: 'queued' | 'uploading' | 'done' | 'error';
  message?: string;
  asset?: MediaAsset;
}

export function IngestSheet() {
  const { ingestOpen, setIngestOpen } = useConsole();
  return (
    <Dialog
      open={ingestOpen}
      onClose={() => setIngestOpen(false)}
      title="Ingest field media"
      description="Upload straight into your Cloudinary cloud, or sync what is already there by tag."
      className="max-w-[760px]"
    >
      <IngestBody />
    </Dialog>
  );
}

function IngestBody() {
  const { settings, addUserAssets, assets, setSettingsOpen, setIngestOpen, inspect, navigate } = useConsole();
  const enabled = canUpload(settings);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const sites = sitesOf(assets);
  const [meta, setMeta] = useState<IngestMetadata>({ title: '', site: sites[0] ?? 'Building B', category: 'structural', severity: undefined, note: '' });
  const [syncTag, setSyncTag] = useState(settings.tag);
  const [sync, setSync] = useState<{ state: 'idle' | 'running' | 'done' | 'error'; message?: string }>({ state: 'idle' });

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

  const runSync = async () => {
    setSync({ state: 'running' });
    try {
      const [images, videos] = await Promise.all([
        listByTag(settings.cloudName, syncTag, 'image'),
        listByTag(settings.cloudName, syncTag, 'video'),
      ]);
      const synced = [
        ...images.map((r) => ({ r, type: 'image' as const })),
        ...videos.map((r) => ({ r, type: 'video' as const })),
      ].map(({ r, type }) =>
        toMediaAsset({
          cloudName: settings.cloudName,
          publicId: r.public_id,
          resourceType: type,
          format: r.format,
          width: r.width,
          height: r.height,
          createdAt: r.created_at,
          context: r.context?.custom,
          tags: [syncTag],
          source: 'sync',
        }),
      );
      addUserAssets(synced);
      setSync({
        state: 'done',
        message: synced.length
          ? `${synced.length} assets tagged “${syncTag}” on ${settings.cloudName} are now in the library.`
          : `Nothing on ${settings.cloudName} carries the tag “${syncTag}”.`,
      });
    } catch (error) {
      setSync({ state: 'error', message: (error as Error).message });
    }
  };

  const done = queue.filter((q) => q.status === 'done');

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
      {/* Upload */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[13.5px] font-semibold">Upload to Cloudinary</h3>
          <span className="font-mono text-[11px] text-ink-3">
            {settings.cloudName} · preset {settings.uploadPreset || '—'}
          </span>
        </div>

        {!enabled ? (
          <div className="rounded-[10px] border border-line bg-raised p-4 text-[13px] leading-relaxed text-ink-2">
            <p>
              Uploads need your own Cloudinary cloud and an <span className="font-medium text-ink">unsigned upload preset</span> — no API secret is ever used.
              Set <code className="font-mono text-[12px] text-ink">NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME</code> and{' '}
              <code className="font-mono text-[12px] text-ink">NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET</code> in <code className="font-mono text-[12px]">.env.local</code>, or enter
              them for this browser.
            </p>
            <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => setSettingsOpen(true)}>
              Configure Cloudinary
            </button>
          </div>
        ) : (
          <>
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
                          <span className="block h-full bg-signal transition-[width]" style={{ width: `${Math.round(q.progress * 100)}%` }} />
                        </span>
                      )}
                      {q.status === 'done' && q.asset && (
                        <span className="block font-mono text-[11px] text-ink-3">
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
          </>
        )}
      </section>

      {/* Sync */}
      <section className="space-y-3 border-t border-line pt-5">
        <div>
          <h3 className="text-[13.5px] font-semibold">Sync from Cloudinary</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
            Reads every image and video tagged <span className="font-mono text-ink-2">{syncTag || '…'}</span> on{' '}
            <span className="font-mono text-ink-2">{settings.cloudName}</span> through Cloudinary’s client-side resource list, including the context
            metadata written at upload. No credentials needed; the cloud must allow resource lists.
          </p>
        </div>
        <div className="flex gap-2">
          <input className="input font-mono" value={syncTag} onChange={(e) => setSyncTag(e.target.value.trim())} aria-label="Tag" maxLength={60} />
          <button type="button" className="btn btn-secondary shrink-0" disabled={!syncTag || sync.state === 'running'} onClick={runSync}>
            {sync.state === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sync
          </button>
        </div>
        {sync.message && (
          <p className={cn('text-[12.5px]', sync.state === 'error' ? 'text-critical' : 'text-ink-2')}>
            {sync.state === 'error' ? 'Cloudinary: ' : ''}
            {sync.message}
          </p>
        )}
      </section>
    </div>
  );
}
