'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { MediaAsset } from '@/lib/types';
import { displayUrl, playbackUrl } from '@/lib/cloudinary/media';
import {
  IMAGE_ACCEPT,
  getMeasurement,
  measure,
  measurementsVersion,
  subscribeMeasurements,
  type DeliveryMetrics,
} from '@/lib/cloudinary/probe';
import { fetchInsight, type CloudinaryInsight } from '@/lib/cloudinary/insights';

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

/** The URL VisualOps actually serves for an asset in the console. */
export function servedUrl(asset: MediaAsset): string {
  return asset.resourceType === 'video' ? playbackUrl(asset) : displayUrl(asset, 1600);
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

/** Cloudinary fl_getinfo signals for a set of assets (faces, subject region). */
export function useInsights(assets: MediaAsset[]): Record<string, CloudinaryInsight | 'error' | undefined> {
  const [insights, setInsights] = useState<Record<string, CloudinaryInsight | 'error' | undefined>>({});
  const key = assets.map((a) => a.id).join('|');
  useEffect(() => {
    let cancelled = false;
    assets.forEach((asset) => {
      fetchInsight(asset)
        .then((insight) => {
          if (!cancelled) setInsights((prev) => ({ ...prev, [asset.id]: insight }));
        })
        .catch(() => {
          if (!cancelled) setInsights((prev) => ({ ...prev, [asset.id]: 'error' }));
        });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by asset ids
  }, [key]);
  return insights;
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
  if (!asset || state.id !== asset.id) return {};
  return { insight: state.insight, error: state.error };
}
