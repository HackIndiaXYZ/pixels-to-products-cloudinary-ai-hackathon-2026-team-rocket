'use client';

import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { CloudUpload, Film, Image as ImageIcon, LayoutGrid, Rows3, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Category, MediaAsset, ResourceType, Severity } from '@/lib/types';
import { CATEGORIES, CATEGORY_LABEL, SEVERITIES, fieldAssets, sitesOf } from '@/lib/analytics';
import { thumbUrl } from '@/lib/cloudinary/media';
import { formatBytes, formatDateTime, titleCase } from '@/lib/format';
import { AssetCard } from '@/components/media/AssetCard';
import { CloudImage } from '@/components/media/CloudImage';
import { CategoryTag, SeverityBadge } from '@/components/ui/badges';
import { Segmented } from '@/components/ui/Segmented';
import { useConsole } from '../store';
import { ViewHeader } from './ViewHeader';

type TypeFilter = 'all' | ResourceType;
type SourceFilter = 'all' | 'sample' | 'upload' | 'sync' | 'reference';

function matchesText(asset: MediaAsset, q: string): boolean {
  if (!q) return true;
  const hay = [asset.title, asset.fileName, asset.site, asset.zone ?? '', asset.finding?.title ?? '', asset.finding?.id ?? '', ...asset.tags]
    .join(' ')
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

export function LibraryView() {
  const { assets, now, inspect, inspectId, setIngestOpen } = useConsole();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<TypeFilter>('all');
  const [category, setCategory] = useState<'all' | Category>('all');
  const [severity, setSeverity] = useState<'all' | Severity>('all');
  const [site, setSite] = useState('all');
  const [source, setSource] = useState<SourceFilter>('all');
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');

  const sites = sitesOf(assets);
  const pool = source === 'reference' ? assets.filter((a) => a.collection === 'reference') : fieldAssets(assets);

  const filtered = useMemo(
    () =>
      pool.filter((a) => {
        if (type !== 'all' && a.resourceType !== type) return false;
        if (category !== 'all' && a.finding?.category !== category) return false;
        if (severity !== 'all' && a.finding?.severity !== severity) return false;
        if (site !== 'all' && a.site !== site) return false;
        if (source !== 'all' && source !== 'reference' && a.source !== source) return false;
        return matchesText(a, query);
      }),
    [pool, type, category, severity, site, source, query],
  );

  const activeFilters = [type !== 'all', category !== 'all', severity !== 'all', site !== 'all', source !== 'all', query !== ''].filter(Boolean).length;
  const clear = () => {
    setQuery('');
    setType('all');
    setCategory('all');
    setSeverity('all');
    setSite('all');
    setSource('all');
  };

  return (
    <div className="space-y-5">
      <ViewHeader
        title="Library"
        subtitle={`${fieldAssets(assets).length} field captures · every thumbnail, crop and preview rendered by Cloudinary`}
        actions={
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIngestOpen(true)}>
            <CloudUpload className="h-3.5 w-3.5" /> Ingest or sync
          </button>
        }
      />

      <div className="panel space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1">
            <span className="sr-only">Filter library</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by file, site, tag, finding ID…"
              className="input pl-8"
            />
          </label>
          <Segmented
            ariaLabel="Media type"
            value={type}
            onChange={setType}
            options={[
              { value: 'all', label: 'All' },
              { value: 'image', label: <><ImageIcon className="h-3.5 w-3.5" />Photos</> },
              { value: 'video', label: <><Film className="h-3.5 w-3.5" />Videos</> },
            ]}
          />
          <Segmented
            ariaLabel="Layout"
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'grid', label: <LayoutGrid className="h-3.5 w-3.5" />, title: 'Grid' },
              { value: 'list', label: <Rows3 className="h-3.5 w-3.5" />, title: 'List' },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input h-8 w-auto text-[12.5px]" value={category} onChange={(e) => setCategory(e.target.value as 'all' | Category)} aria-label="Category">
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <select className="input h-8 w-auto text-[12.5px]" value={severity} onChange={(e) => setSeverity(e.target.value as 'all' | Severity)} aria-label="Severity">
            <option value="all">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </select>
          <select className="input h-8 w-auto text-[12.5px]" value={site} onChange={(e) => setSite(e.target.value)} aria-label="Site">
            <option value="all">All sites</option>
            {sites.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select className="input h-8 w-auto text-[12.5px]" value={source} onChange={(e) => setSource(e.target.value as SourceFilter)} aria-label="Source">
            <option value="all">All sources</option>
            <option value="sample">Sample dataset</option>
            <option value="upload">Uploaded here</option>
            <option value="sync">Synced from Cloudinary</option>
            <option value="reference">Cloudinary sample assets</option>
          </select>
          <span className="num ml-auto font-mono text-[11.5px] text-ink-3">
            {filtered.length} of {pool.length}
          </span>
          {activeFilters > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-[14px] font-medium">No media matches these filters</p>
          <p className="text-[13px] text-ink-3">Try fewer filters, or ingest new captures into Cloudinary.</p>
          <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={clear}>
            Clear filters
          </button>
        </div>
      ) : layout === 'grid' ? (
        <LayoutGroup>
          <motion.div layout className="grid grid-cols-1 gap-x-2 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            <AnimatePresence mode="popLayout">
              {filtered.map((asset) => (
                <AssetCard key={asset.id} asset={asset} now={now} onOpen={(a) => inspect(a.id)} selected={inspectId === asset.id} />
              ))}
            </AnimatePresence>
          </motion.div>
        </LayoutGroup>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-line">
                {['Media', 'Finding', 'Severity', 'Category', 'Site', 'Captured', 'Original'].map((h) => (
                  <th key={h} className="label px-3 py-2.5 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((asset) => (
                <tr key={asset.id} className="cursor-pointer transition-colors hover:bg-raised" onClick={() => inspect(asset.id)}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      <span className="relative h-10 w-16 shrink-0 overflow-hidden rounded-[6px] border border-line bg-raised">
                        <CloudImage src={thumbUrl(asset, 128, 80)} alt="" className="h-full w-full object-cover" />
                      </span>
                      <span className="font-mono text-[11.5px] text-ink-2">{asset.fileName}</span>
                    </div>
                  </td>
                  <td className="max-w-[280px] truncate px-3 py-2">
                    <button type="button" className="text-left hover:underline" onClick={() => inspect(asset.id)}>
                      {asset.finding?.title ?? asset.title}
                    </button>
                  </td>
                  <td className="px-3 py-2">{asset.finding ? <SeverityBadge severity={asset.finding.severity} /> : <span className="text-ink-3">—</span>}</td>
                  <td className="px-3 py-2">{asset.finding ? <CategoryTag category={asset.finding.category} /> : <span className="text-ink-3">—</span>}</td>
                  <td className="px-3 py-2 text-ink-2">{asset.site}</td>
                  <td className="num px-3 py-2 font-mono text-[11.5px] text-ink-3">{formatDateTime(asset.capturedAt)}</td>
                  <td className="num px-3 py-2 font-mono text-[11.5px] text-ink-3">
                    {asset.format.toUpperCase()} {formatBytes(asset.bytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
