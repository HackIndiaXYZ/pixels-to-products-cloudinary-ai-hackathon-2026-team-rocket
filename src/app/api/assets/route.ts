import type { NextRequest } from 'next/server';
import type { CloudResource } from '@/lib/cloudinary/backend';
import { cloudinaryErrorMessage, cloudinaryFor, jsonError, NOT_CONFIGURED, rateLimited, serverConfig } from '@/lib/server/cloudinary';

export const dynamic = 'force-dynamic';

interface SearchResource {
  public_id: string;
  asset_id?: string;
  resource_type: string;
  format?: string;
  width?: number;
  height?: number;
  bytes?: number;
  duration?: number;
  created_at?: string;
  display_name?: string;
  filename?: string;
  tags?: string[];
  context?: Record<string, unknown>;
}

/** Search returns context as a flat map; the Admin API nests it under `custom`. Accept both. */
function flattenContext(context: Record<string, unknown> | undefined): Record<string, string> {
  if (!context) return {};
  const source = (context.custom && typeof context.custom === 'object' ? context.custom : context) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) if (typeof v === 'string') out[k] = v;
  return out;
}

/**
 * GET /api/assets?cursor=… — the VisualOps records stored in the team's Cloudinary cloud.
 *
 * Uses Cloudinary's Search API (server-side, API secret) for every image and video carrying the
 * VisualOps tag, newest first, with their tags and contextual metadata. This replaces the public
 * client-side resource list, so the cloud can keep "Resource list" restricted.
 */
export async function GET(request: NextRequest) {
  const config = serverConfig();
  if (!config) return jsonError(503, NOT_CONFIGURED, { configured: false });
  if (rateLimited(request, 'assets', 120, 10 * 60 * 1000)) return jsonError(429, 'Too many requests. Try again in a few minutes.');

  const cursor = request.nextUrl.searchParams.get('cursor');
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('limit')) || 100));

  try {
    let query = cloudinaryFor(config)
      .search.expression(`tags=${config.tag} AND (resource_type:image OR resource_type:video)`)
      .with_field('context')
      .with_field('tags')
      .sort_by('created_at', 'desc')
      .max_results(limit);
    if (cursor && /^[A-Za-z0-9+/=_-]{1,512}$/.test(cursor)) query = query.next_cursor(cursor);
    const result = (await query.execute()) as { resources?: SearchResource[]; next_cursor?: string; total_count?: number };

    const resources: CloudResource[] = (result.resources ?? [])
      .filter((r) => r.resource_type === 'image' || r.resource_type === 'video')
      .map((r) => ({
        public_id: r.public_id,
        asset_id: r.asset_id,
        resource_type: r.resource_type as 'image' | 'video',
        format: r.format ?? (r.resource_type === 'video' ? 'mp4' : 'jpg'),
        width: r.width,
        height: r.height,
        bytes: r.bytes,
        duration: r.duration,
        created_at: r.created_at,
        display_name: r.display_name ?? r.filename,
        tags: r.tags ?? [],
        context: flattenContext(r.context),
      }));

    return Response.json(
      { cloudName: config.cloudName, tag: config.tag, resources, nextCursor: result.next_cursor ?? null, total: result.total_count ?? resources.length },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const { message, status } = cloudinaryErrorMessage(error);
    return jsonError(status === 401 || status === 403 ? 502 : status, `Cloudinary search failed: ${message}`);
  }
}
