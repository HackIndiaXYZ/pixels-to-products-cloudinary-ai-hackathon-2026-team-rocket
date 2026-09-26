'use client';

import { Download, ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { MediaAsset } from '@/lib/types';
import { generateSnippets, type CodeSnippets } from '@/lib/cloudinary/codegen';
import type { PipelineStep } from '@/lib/cloudinary/pipeline';
import { sanitizeFileName } from '@/lib/cloudinary/url';
import { downloadText } from '@/lib/report';
import { CopyButton } from '@/components/ui/CopyButton';
import { Dialog } from '@/components/ui/Dialog';
import { Segmented } from '@/components/ui/Segmented';

type Tab = keyof CodeSnippets;

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'react', label: 'React' },
  { value: 'url', label: 'URL' },
  { value: 'node', label: 'Node.js' },
  { value: 'python', label: 'Python' },
  { value: 'curl', label: 'cURL' },
  { value: 'json', label: 'JSON' },
];

const NOTES: Record<Tab, string> = {
  react: 'next-cloudinary. Verified by running these props through next-cloudinary’s URL loader.',
  url: 'The exact URL rendered in the Studio — works anywhere, no SDK needed.',
  node: 'cloudinary (Node.js SDK). Verified: the SDK produces the same transformation string.',
  python: 'cloudinary (Python SDK). Same transformation objects as the Node.js snippet.',
  curl: 'Fetch the processed file from the command line.',
  json: 'The pipeline state: asset, ordered steps, their components and evidence integrity.',
};

export function CodeExportDialog({
  open,
  onClose,
  asset,
  steps,
}: {
  open: boolean;
  onClose: () => void;
  asset: MediaAsset;
  steps: PipelineStep[];
}) {
  const [tab, setTab] = useState<Tab>('react');
  const snippets = useMemo(() => generateSnippets(steps, asset), [steps, asset]);
  const code = snippets[tab];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export pipeline"
      description={`${asset.fileName} · ${asset.cloudName}/${asset.resourceType}/upload/${asset.publicId}`}
      className="max-w-3xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <Segmented size="sm" ariaLabel="Snippet language" value={tab} onChange={setTab} options={TABS} />
        <div className="flex items-center gap-1.5">
          {tab === 'url' && (
            <a className="btn btn-secondary btn-sm" href={snippets.url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </a>
          )}
          {tab === 'json' && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => downloadText(`${sanitizeFileName(asset.fileName)}.pipeline.json`, snippets.json, 'application/json')}
            >
              <Download className="h-3.5 w-3.5" /> Download
            </button>
          )}
          <CopyButton value={code} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-canvas">
        <pre className="code whitespace-pre-wrap break-all px-5 py-4 text-ink">
          <code>{code}</code>
        </pre>
      </div>
      <p className="border-t border-line px-5 py-3 text-[12px] text-ink-3">{NOTES[tab]}</p>
    </Dialog>
  );
}
