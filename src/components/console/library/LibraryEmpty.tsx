'use client';

import { CloudUpload, X } from 'lucide-react';

/** Empty result state: says exactly which filters produced nothing, and how to get media back in view. */
export function LibraryEmpty({
  summary,
  total,
  onClear,
  onIngest,
}: {
  summary: string[];
  total: number;
  onClear: () => void;
  onIngest: () => void;
}) {
  return (
    <div className="panel overflow-hidden">
      <div className="grid items-center gap-10 px-6 py-14 sm:px-10 md:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-w-0">
          <p className="label">No match</p>
          <h2 className="type-heading mt-3 text-[26px] text-ink sm:text-[30px]">Nothing in view.</h2>
          <p className="mt-3 max-w-[52ch] text-[13.5px] leading-relaxed text-ink-3">
            {summary.length ? (
              <>
                No captures match <span className="text-ink-2">{summary.join(' · ')}</span>.{' '}
              </>
            ) : null}
            Loosen a filter, or ingest new captures into Cloudinary — uploads and tag syncs appear here as soon as they arrive.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClear}>
              <X className="h-3.5 w-3.5" /> Clear filters
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onIngest}>
              <CloudUpload className="h-3.5 w-3.5" /> Ingest or sync
            </button>
          </div>
        </div>
        <div aria-hidden className="survey-grid relative hidden aspect-[4/3] rounded-[8px] border border-dashed border-line-strong md:block">
          <span className="reticle" />
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span className="num font-mono text-[26px] font-medium tracking-[-0.02em] text-ink-2">0</span>
            <span className="label">
              of <span className="num">{total}</span> frames
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
