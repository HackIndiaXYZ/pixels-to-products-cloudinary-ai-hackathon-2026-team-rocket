import type { AiUnderstanding } from '@/lib/types';
import { decodeAiContext, encodeAiContext, parseDetection } from '@/lib/cloudinary/ai';
import { CTX } from '@/lib/cloudinary/record-context';
import { cloudinaryErrorMessage, cloudinaryFor, forgetListMemo, isSameOrigin, jsonError, NOT_CONFIGURED, rateLimited, serverConfig } from '@/lib/server/cloudinary';
import { customContext, loadVisualOpsAsset, NO_STORE, parsePublicId, readJsonBody, type AdminResource } from '../guards';

export const dynamic = 'force-dynamic';

/** Context keys this route owns. They are rewritten on every analysis; every other key is kept as it is. */
const AI_KEYS: readonly string[] = [CTX.aiCaption, CTX.aiObjects, CTX.aiTags, CTX.aiModel, CTX.analyzedAt];

/** Each analysis spends two Cloudinary AI detections (captioning + coco_v2); the free plan has 500 a month. */
const LIMIT = 20;
const WINDOW_MS = 10 * 60 * 1000;

/**
 * POST /api/assets/[id]/analyze — Cloudinary AI understanding of one VisualOps image.
 *
 * `[id]` is the URL-encoded public_id. Body: `{ resourceType: 'image' }`.
 *
 * Runs Cloudinary AI Content Analysis through the Admin API (synchronous `update`):
 *  1. `detection: 'captioning'`                    → a one-sentence caption of the frame
 *  2. `detection: 'coco_v2', auto_tagging: 0.5`    → objects with boxes; Cloudinary adds a tag per object ≥ 0.5
 * parses both with `parseDetection`, and writes the result into the asset's own contextual metadata
 * (ai_caption, ai_objects, ai_tags, ai_model, analyzed_at), merged with the record keys already there,
 * so Cloudinary stays the system of record and every device reads the same understanding back.
 *
 * An asset analysed before returns its stored result (`cached: true`) without spending detections.
 * If one of the two detections fails, what the other returned is still saved
 * and the response carries a `warning`.
 *
 * 200 { ai, tags, cached?, warning? }  (`tags` = the asset's full tag list after auto-tagging)
 * 400 invalid id / video / bad body · 403 cross-site or not a VisualOps asset · 404 no such asset
 * 429 rate limited · 502 Cloudinary error (message only, no credentials) · 503 server not configured
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const config = serverConfig();
  if (!config) return jsonError(503, NOT_CONFIGURED, { configured: false });
  if (!isSameOrigin(request)) return jsonError(403, 'AI analysis can only be requested from this site.');
  if (rateLimited(request, 'analyze', LIMIT, WINDOW_MS)) {
    return jsonError(429, 'Too many AI analyses from this address. Each one spends Cloudinary AI detections; try again in a few minutes.');
  }

  const publicId = parsePublicId((await params).id);
  if (!publicId) return jsonError(400, 'Invalid public_id.');

  const parsed = await readJsonBody(request);
  if ('error' in parsed) return parsed.error;
  const { resourceType = 'image' } = parsed.body;
  if (resourceType === 'video') {
    return jsonError(400, 'AI analysis runs on images. A video keeps its face and crop signals (fl_getinfo on the poster frame).');
  }
  if (resourceType !== 'image') return jsonError(400, 'resourceType must be "image".');

  const loaded = await loadVisualOpsAsset(config, publicId, 'image');
  if ('error' in loaded) return loaded.error;
  const before = loaded.resource;
  const beforeTags = before.tags ?? [];
  const context = customContext(before);
  const previous = decodeAiContext(context);

  // Already understood: return what Cloudinary said then, instead of spending two more detections.
  // This public route never re-runs an analysis, so a script can't drain the team's AI quota on one image;
  // `npm run seed:cloudinary -- --force` re-analyses from the command line with the team's credentials.
  if (previous?.analyzedAt) {
    return Response.json({ ai: previous, tags: beforeTags, cached: true }, NO_STORE);
  }

  const cld = cloudinaryFor(config);
  const failures: string[] = [];
  const detect = async (label: string, options: Record<string, unknown>): Promise<AdminResource | undefined> => {
    try {
      return (await cld.api.update(publicId, { resource_type: 'image', type: 'upload', ...options })) as AdminResource;
    } catch (error) {
      failures.push(`${label}: ${cloudinaryErrorMessage(error).message}`);
      return undefined;
    }
  };

  const captioned = await detect('Captioning', { detection: 'captioning' });
  const detected = await detect('Object detection', { detection: 'coco_v2', auto_tagging: 0.5 });
  if (!captioned && !detected) return jsonError(502, `Cloudinary AI analysis failed. ${failures.join(' · ')}`);

  // The second response normally repeats the caption; prefer the captioning call's own copy.
  const objectInfo = detected?.info?.detection ?? {};
  const captionInfo = captioned?.info?.detection ?? {};
  const detection = { ...objectInfo, ...(captionInfo.captioning ? { captioning: captionInfo.captioning } : {}) };
  // Boxes arrive in pixels of the analysed original.
  const width = detected?.width ?? captioned?.width ?? before.width ?? 0;
  const height = detected?.height ?? captioned?.height ?? before.height ?? 0;
  const ai: AiUnderstanding = parseDetection(detection, width, height);

  // Tags auto_tagging added in this run, plus the ones an earlier run added that are still on the asset.
  let tags = detected?.tags ?? captioned?.tags ?? beforeTags;
  if (detected && !detected.tags) {
    // The update response normally lists the tags; if not, read them back rather than miss the auto-tags.
    const reread = await cld.api
      .resource(publicId, { resource_type: 'image', type: 'upload' })
      .then((r) => (r as AdminResource).tags)
      .catch(() => undefined);
    if (reread) tags = reread;
  }
  const added = tags.filter((t) => !beforeTags.includes(t));
  const kept = (previous?.tags ?? []).filter((t) => tags.includes(t));
  ai.tags = Array.from(new Set([...kept, ...added])).filter((t) => t !== config.tag);
  ai.analyzedAt = new Date().toISOString();

  // The SDK's update replaces the whole context: write the record keys back with the fresh AI keys.
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) if (!AI_KEYS.includes(key)) merged[key] = value;
  Object.assign(merged, encodeAiContext(ai));
  try {
    await cld.api.update(publicId, { resource_type: 'image', type: 'upload', context: merged });
  } catch (error) {
    return jsonError(
      502,
      `Cloudinary analysed the image, but saving the result to its context metadata failed: ${cloudinaryErrorMessage(error).message}`,
      { ai, tags },
    );
  }

  const warning = failures.length
    ? `${failures.join(' · ')}. Saved what the other detection returned.`
    : undefined;
  forgetListMemo(); // the record's context and tags changed
  return Response.json({ ai, tags, ...(warning ? { warning } : {}) }, NO_STORE);
}
