import type { AiObject, AiUnderstanding } from '@/lib/types';
import { CTX } from './record-context';

/**
 * Cloudinary AI Content Analysis results ⇄ VisualOps AI understanding ⇄ contextual metadata.
 * Used by the analyze route (server) and by the record mapper (browser).
 */

interface DetectedTag {
  'bounding-box'?: number[];
  confidence?: number;
  categories?: string[];
}

interface DetectionInfo {
  captioning?: { status?: string; data?: { caption?: string }; model_version?: number };
  object_detection?: {
    status?: string;
    data?: Record<string, { tags?: Record<string, DetectedTag[]>; model_name?: string; model_version?: number }>;
  };
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const clampPct = (n: number) => Math.max(0, Math.min(100, n));
/** Labels and captions travel inside context values: keep them free of the context/field separators. */
const clean = (s: string) => s.replace(/[|;=\n\r]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Parses `info.detection` from an Admin API update / upload response. Bounding boxes arrive in
 * pixels of the analysed image ([x, y, w, h]); they are converted to percent of the frame.
 */
export function parseDetection(detection: unknown, width: number, height: number, minConfidence = 0.3): AiUnderstanding {
  const info = (detection ?? {}) as DetectionInfo;
  const objects: AiObject[] = [];
  const models: string[] = [];
  if (info.captioning?.status === 'complete') models.push(`captioning v${info.captioning.model_version ?? '?'}`);
  for (const [model, result] of Object.entries(info.object_detection?.data ?? {})) {
    models.push(`${result.model_name ?? model} v${result.model_version ?? '?'}`);
    for (const [label, hits] of Object.entries(result.tags ?? {})) {
      for (const hit of hits) {
        const confidence = hit.confidence ?? 0;
        if (confidence < minConfidence) continue;
        const bb = hit['bounding-box'];
        const box =
          bb && bb.length === 4 && width > 0 && height > 0
            ? {
                x: round(clampPct((bb[0] / width) * 100)),
                y: round(clampPct((bb[1] / height) * 100)),
                w: round(clampPct((bb[2] / width) * 100)),
                h: round(clampPct((bb[3] / height) * 100)),
                label: clean(label).toUpperCase(),
              }
            : undefined;
        objects.push({ label: clean(label), confidence: round(confidence, 2), box });
      }
    }
  }
  objects.sort((a, b) => b.confidence - a.confidence);
  const caption = info.captioning?.data?.caption ? clean(info.captioning.data.caption).slice(0, 600) : undefined;
  return { caption, objects: objects.slice(0, 12), tags: [], model: models.join(' · ') || undefined };
}

/** AI understanding → contextual metadata values (each well under Cloudinary's 1024-character limit). */
export function encodeAiContext(ai: AiUnderstanding): Record<string, string> {
  const objects = ai.objects
    .map((o) => `${clean(o.label)}|${o.confidence.toFixed(2)}|${o.box ? [o.box.x, o.box.y, o.box.w, o.box.h].join(',') : ''}`)
    .join(';');
  const out: Record<string, string> = {};
  if (ai.caption) out[CTX.aiCaption] = ai.caption.slice(0, 600);
  if (objects) out[CTX.aiObjects] = objects.slice(0, 900);
  if (ai.tags.length) out[CTX.aiTags] = ai.tags.map(clean).join(',').slice(0, 400);
  if (ai.model) out[CTX.aiModel] = ai.model.slice(0, 120);
  out[CTX.analyzedAt] = ai.analyzedAt ?? new Date().toISOString();
  return out;
}

/** Contextual metadata → AI understanding (undefined when the asset has not been analysed). */
export function decodeAiContext(ctx: Record<string, string> | undefined): AiUnderstanding | undefined {
  if (!ctx || !(ctx[CTX.aiCaption] || ctx[CTX.aiObjects] || ctx[CTX.analyzedAt])) return undefined;
  const objects: AiObject[] = (ctx[CTX.aiObjects] ?? '')
    .split(';')
    .filter(Boolean)
    .map((entry) => {
      const [label, conf, box] = entry.split('|');
      const nums = (box ?? '').split(',').map(Number);
      return {
        label: (label ?? '').trim(),
        confidence: Number(conf) || 0,
        box:
          nums.length === 4 && nums.every((n) => Number.isFinite(n))
            ? { x: nums[0], y: nums[1], w: nums[2], h: nums[3], label: (label ?? '').trim().toUpperCase() }
            : undefined,
      };
    })
    .filter((o) => o.label);
  return {
    caption: ctx[CTX.aiCaption] || undefined,
    objects,
    tags: (ctx[CTX.aiTags] ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    model: ctx[CTX.aiModel] || undefined,
    analyzedAt: ctx[CTX.analyzedAt] || undefined,
  };
}

/** Words the search can match on: caption, detected object labels and AI tags. */
export function aiSearchText(ai: AiUnderstanding | undefined): string[] {
  if (!ai) return [];
  return [ai.caption ?? '', ...ai.objects.map((o) => o.label), ...ai.tags].map((s) => s.toLowerCase()).filter(Boolean);
}
