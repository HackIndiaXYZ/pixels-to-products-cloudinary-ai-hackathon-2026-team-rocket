import type { NextRequest } from 'next/server';
import { CTX } from '@/lib/cloudinary/record-context';
import { cloudinaryFor, forgetListMemo, isSameOrigin, jsonError, NOT_CONFIGURED, rateLimited, serverConfig } from '@/lib/server/cloudinary';
import { cloudinaryFailure, customContext, loadVisualOpsAsset, NO_STORE, parsePublicId, parseResourceType, readJsonBody } from './guards';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/assets/[id]?resourceType=image|video — takes one record out of the VisualOps workspace.
 *
 * Non-destructive: removes only the VisualOps tag from the asset (Upload API `tags` command
 * `remove`), so the Search API stops returning it as a record. The media, its other tags and its
 * contextual metadata stay in Cloudinary; tagging it again brings the record back as it was.
 *
 * Team-seeded sample records (context `provenance=sample-annotation`) are protected: the live workspace is
 * shared and has no accounts, so no visitor or script can take its demo records out. Records added through
 * ingest can be removed. The team maintains the seeded set with `npm run seed:cloudinary`.
 *
 * `[id]` is the URL-encoded public_id; `resourceType` comes from the query or a JSON body.
 * 200 { removed: true, publicId, tag }
 * 400 invalid id / resource type · 403 cross-site, not a VisualOps asset or a protected sample record · 404 no such asset
 * 429 rate limited · 502 Cloudinary error · 503 server not configured
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const config = serverConfig();
  if (!config) return jsonError(503, NOT_CONFIGURED, { configured: false });
  if (!isSameOrigin(request)) return jsonError(403, 'Records can only be removed from this site.');
  if (rateLimited(request, 'untag', 30, 10 * 60 * 1000)) return jsonError(429, 'Too many removals from this address. Try again in a few minutes.');

  const publicId = parsePublicId((await params).id);
  if (!publicId) return jsonError(400, 'Invalid public_id.');

  const parsed = await readJsonBody(request);
  if ('error' in parsed) return parsed.error;
  const resourceType = parseResourceType(request.nextUrl.searchParams.get('resourceType') ?? parsed.body.resourceType ?? 'image');
  if (!resourceType) return jsonError(400, 'resourceType must be "image" or "video".');

  const loaded = await loadVisualOpsAsset(config, publicId, resourceType);
  if ('error' in loaded) return loaded.error;
  if (customContext(loaded.resource)[CTX.provenance] === 'sample-annotation') {
    return jsonError(403, 'Sample records are protected in the shared workspace. Records added through ingest can be removed.', {
      protected: true,
    });
  }

  try {
    await cloudinaryFor(config).uploader.remove_tag(config.tag, [publicId], { resource_type: resourceType, type: 'upload' });
  } catch (error) {
    return cloudinaryFailure(error, 'Cloudinary could not remove the VisualOps tag');
  }
  forgetListMemo();
  return Response.json({ removed: true, publicId, tag: config.tag }, NO_STORE);
}
