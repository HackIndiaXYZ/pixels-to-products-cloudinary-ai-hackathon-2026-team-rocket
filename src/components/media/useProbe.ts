'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  getMeasurement,
  measure,
  subscribeMeasurements,
  type ProbeResult,
} from '@/lib/cloudinary/probe';

/**
 * Subscribes a component to Cloudinary's answer for a delivery URL.
 * Triggers a (deduplicated) HEAD probe and keeps polling while Cloudinary
 * replies 423 for asynchronous AI transformations.
 */
export function useProbe(url: string | null, options: { accept?: string; enabled?: boolean } = {}): ProbeResult | undefined {
  const enabled = options.enabled ?? true;
  const result = useSyncExternalStore(
    subscribeMeasurements,
    () => (url ? getMeasurement(url) : undefined),
    () => undefined,
  );

  useEffect(() => {
    if (!url || !enabled) return;
    void measure(url, { accept: options.accept });
  }, [url, enabled, options.accept]);

  return result;
}

/** Seconds elapsed while `active` is true (resets when it turns on again). */
export function useElapsed(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const started = performance.now();
    const id = setInterval(() => setElapsed((performance.now() - started) / 1000), 100);
    return () => {
      clearInterval(id);
      setElapsed(0);
    };
  }, [active]);
  return elapsed;
}
