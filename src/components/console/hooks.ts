'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { MediaAsset } from '@/lib/types';
import { displayUrl, playbackUrl } from '@/lib/cloudinary/media';
import {
  IMAGE_ACCEPT,
  getMeasurement,
  measure,
  measurementsVersion,
  schedulePerFrame,
  subscribeMeasurements,
  type DeliveryMetrics,
} from '@/lib/cloudinary/probe';
import { cachedInsight, fetchInsight, type CloudinaryInsight } from '@/lib/cloudinary/insights';

export function useMeasurementsVersion(): number {
  return useSyncExternalStore(subscribeMeasurements, measurementsVersion, () => 0);
}

export interface DeliveryTotals {
  measured: number;
  total: number;
  imageOriginal: number;
  imageDelivered: number;
  videoOriginal: number;
  videoDelivered: number;
  formats: Record<string, number>;
  byAsset: Record<string, DeliveryMetrics | undefined>;
}

/** Width limit (c_limit) of the still VisualOps serves for a photo in the console. */
export const SERVED_IMAGE_WIDTH = 1600;
/** Width limit (c_limit) of the playback rendition VisualOps serves for a video in the console. */
export const SERVED_VIDEO_WIDTH = 1280;

/** The URL VisualOps actually serves for an asset in the console. */
export function servedUrl(asset: MediaAsset): string {
  return asset.resourceType === 'video' ? playbackUrl(asset, SERVED_VIDEO_WIDTH) : displayUrl(asset, SERVED_IMAGE_WIDTH);
}

/**
 * Live delivery totals: HEAD-probes the rendition VisualOps serves for each
 * asset and sums Cloudinary's reported original vs delivered bytes.
 */
export function useDeliveryTotals(assets: MediaAsset[]): DeliveryTotals {
  const urls = useMemo(() => assets.map((a) => [a, servedUrl(a)] as const), [assets]);
  useEffect(() => {
    urls.forEach(([a, url]) => void measure(url, { accept: a.resourceType === 'image' ? IMAGE_ACCEPT : undefined }));
  }, [urls]);
  const version = useMeasurementsVersion();

  return useMemo(() => {
    void version;
    const totals: DeliveryTotals = {
      measured: 0,
      total: urls.length,
      imageOriginal: 0,
      imageDelivered: 0,
      videoOriginal: 0,
      videoDelivered: 0,
      formats: {},
      byAsset: {},
    };
    for (const [asset, url] of urls) {
      const r = getMeasurement(url);
      if (!r || r.kind !== 'ready') continue;
      const m = r.metrics;
      totals.measured += 1;
      totals.byAsset[asset.id] = m;
      if (m.format) totals.formats[m.format] = (totals.formats[m.format] ?? 0) + 1;
      if (asset.resourceType === 'image') {
        totals.imageOriginal += m.originalBytes ?? asset.bytes ?? 0;
        totals.imageDelivered += m.bytes ?? 0;
      } else {
        // Video originals are recorded at ingest; the delivered rendition is measured live.
        totals.videoOriginal += asset.bytes ?? 0;
        totals.videoDelivered += m.bytes ?? 0;
      }
    }
    return totals;
  }, [urls, version]);
}

export type InsightState = CloudinaryInsight | 'error' | undefined;

/** The fl_getinfo answers this session already holds for `assets` (no request, no wait). */
function seedInsights(assets: MediaAsset[]): Record<string, InsightState> {
  const out: Record<string, InsightState> = {};
  for (const asset of assets) {
    const insight = cachedInsight(asset);
    if (insight) out[asset.id] = insight;
  }
  return out;
}

/**
 * Cloudinary fl_getinfo signals (g_auto crop window and face detections) for a
 * set of assets, keyed by asset id: an insight, 'error', or undefined while the
 * request is pending.
 *
 * Answers already cached this session are in the first render. Answers that
 * arrive later are gathered and committed together, once per animation frame
 * (the probe store's shared scheduler), so a dataset's worth of responses costs
 * a handful of renders instead of one per response — and no tile waits for the
 * slowest request.
 */
export function useInsights(assets: MediaAsset[]): Record<string, InsightState> {
  const [store, setStore] = useState<Record<string, InsightState>>(() => seedInsights(assets));
  const key = assets.map((a) => a.id).join('|');

  useEffect(() => {
    let cancelled = false;
    let cancelFlush: (() => void) | undefined;
    let batch: Record<string, InsightState> = {};
    const flush = () => {
      if (cancelled) return;
      const arrived = batch;
      batch = {};
      setStore((prev) => {
        // Answers the first render already showed (cached ones) change nothing: keep the same object so React bails out.
        const changed = Object.keys(arrived).some((id) => prev[id] !== arrived[id]);
        return changed ? { ...prev, ...arrived } : prev;
      });
    };
    const collect = (id: string, value: InsightState) => {
      if (cancelled) return;
      batch[id] = value;
      cancelFlush = schedulePerFrame(flush); // deduplicated: one flush per frame however many answers arrive
    };
    assets.forEach((asset) => {
      fetchInsight(asset).then(
        (insight) => collect(asset.id, insight),
        () => collect(asset.id, 'error'),
      );
    });
    return () => {
      cancelled = true;
      cancelFlush?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by asset ids
  }, [key]);

  // Only the requested assets: answers for assets no longer in the list are never counted.
  return useMemo(() => {
    const out: Record<string, InsightState> = {};
    for (const asset of assets) out[asset.id] = store[asset.id];
    return out;
  }, [assets, store]);
}

export function useInsight(asset: MediaAsset | undefined): { insight?: CloudinaryInsight; error?: string } {
  const [state, setState] = useState<{ id?: string; insight?: CloudinaryInsight; error?: string }>({});
  useEffect(() => {
    if (!asset) return;
    let cancelled = false;
    fetchInsight(asset)
      .then((insight) => !cancelled && setState({ id: asset.id, insight }))
      .catch((error: Error) => !cancelled && setState({ id: asset.id, error: error.message }));
    return () => {
      cancelled = true;
    };
  }, [asset]);
  if (!asset) return {};
  if (state.id !== asset.id) {
    // Already answered this session: show it now rather than one render later.
    const cached = cachedInsight(asset);
    return cached ? { insight: cached } : {};
  }
  return { insight: state.insight, error: state.error };
}
