'use client';

import { useEffect, useState } from 'react';
import { evidenceUrl } from '@/lib/cloudinary/media';
import { IMAGE_ACCEPT, measure } from '@/lib/cloudinary/probe';
import { formatBytes } from '@/lib/format';
import { LiveDot } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { landingAsset } from '../landing-data';

/** Evidence width limit: the rendition is capped at this width (c_limit), never upscaled. */
const LIMIT = 1600;

/**
 * Field photos measured at evidence quality (c_limit to 1600 px, e_improve,
 * e_sharpen, q_auto, f_auto). Images only, so like is compared with like:
 * Server-Timing's original for an image is the stored file itself, while for a
 * video still it would be an intermediate frame grab, not the uploaded video.
 */
const PROOF_IDS = ['vo-ole-survey', 'vo-road-collapse', 'vo-crew-ppe', 'vo-receiving-label', 'vo-bridge-truss', 'vo-fleet-checkin'];

interface Proof {
  original: number;
  delivered: number;
  count: number;
}

/**
 * Page-level proof, measured live: what the stored originals weigh versus what
 * Cloudinary actually delivers for the same photos, read from its own
 * Server-Timing headers. Nothing here is estimated, and the line says where the
 * saving comes from: the resize to the evidence width as well as optimisation.
 */
export function DeliveryProof({ className }: { className?: string }) {
  const [proof, setProof] = useState<Proof | 'failed' | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(PROOF_IDS.map((id) => measure(evidenceUrl(landingAsset(id), LIMIT), { accept: IMAGE_ACCEPT })))
      .then((results) => {
        if (cancelled) return;
        let original = 0;
        let delivered = 0;
        let count = 0;
        for (const r of results) {
          if (r.kind === 'ready' && r.metrics.originalBytes && r.metrics.bytes) {
            original += r.metrics.originalBytes;
            delivered += r.metrics.bytes;
            count += 1;
          }
        }
        setProof(count ? { original, delivered, count } : 'failed');
      })
      .catch(() => {
        if (!cancelled) setProof('failed');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const change = proof && proof !== 'failed' ? Math.round((proof.delivered / proof.original - 1) * 100) : 0;

  return (
    <p className={cn('flex items-start gap-2.5 text-[12.5px] leading-relaxed text-ink-3', className)}>
      <LiveDot className="mt-[7px] shrink-0" />
      <span>
        {/* Interim text is not announced; only the final measurement is (role=status). */}
        {proof === null && `Measuring what Cloudinary delivers for ${PROOF_IDS.length} field photos…`}
        <span role="status">
          {proof === 'failed' && 'Live delivery measurement is unavailable right now.'}
          {proof && proof !== 'failed' && (
            <>
              Measured just now: {proof.count} field photos —{' '}
              <span className="num text-ink-2">{formatBytes(proof.original)}</span> of originals, delivered by Cloudinary as{' '}
              <span className="num text-signal">{formatBytes(proof.delivered)}</span>{' '}
              <span className="num text-ink-2">
                ({change <= 0 ? '−' : '+'}
                {Math.abs(change)}%
              </span>
              , resized to ≤{LIMIT} px and optimised).
            </>
          )}
        </span>
      </span>
    </p>
  );
}
