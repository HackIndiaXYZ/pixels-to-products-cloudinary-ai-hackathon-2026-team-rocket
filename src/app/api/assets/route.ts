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
 * A public ID accepted for an exact lookup: letters, digits, `_ - . /` and inner spaces, at most 255
 * characters, no empty or dot-only path segments. Quotes, backslashes and every other character that
 * could change the meaning of the Search expression are rejected, not escaped.
 */
function isLookupPublicId(value: string): boolean {
  if (value.length < 1 || value.length > 255) return false;
  if (!/^[A-Za-z0-9_\-./ ]+$/.test(value)) return false;
  if (/^[\s/.]|[\s/]$/.test(value)) return false;
  return value.split('/').every((segment) => segment.length > 0 && !/^\.+$/.test(segment) && segment.trim() === segment);
}

/**
 * GET /api/assets?cursor=… — the VisualOps records stored in the team's Cloudinary cloud.
 * GET /api/assets?public_id=… — one record, by exact public ID (it must carry the VisualOps tag).
 *
 * Uses Cloudinary's Search API (server-side, API secret) for every image and video carrying the
 * VisualOps tag, newest first, with their tags and contextual metadata. This replaces the public
 * client-side resource list, so the cloud can keep "Resource list" restricted. An exact lookup answers
 * with the same shape: `resources` holds the match (an image and a video may share a public ID) or is empty.
 */
export async function GET(request: NextRequest) {
  const config = serverConfig();
  if (!config) return jsonError(503, NOT_CONFIGURED, { configured: false });
  if (rateLimited(request, 'assets', 120, 10 * 60 * 1000)) return jsonError(429, 'Too many requests. Try again in a few minutes.');

  const params = request.nextUrl.searchParams;
  const publicId = params.get('public_id');
  if (publicId !== null && !isLookupPublicId(publicId)) return jsonError(400, 'Invalid public_id.');

  const cursor = params.get('cursor');
  const limit = Math.min(100, Math.max(1, Number(params.get('limit')) || 100));
  const types = '(resource_type:image OR resource_type:video)';

  try {
    let query = cloudinaryFor(config)
      .search.expression(
        publicId !== null
          ? // Exact match; the value is validated above, so the quotes can't be closed from inside.
            `public_id="${publicId}" AND tags=${config.tag} AND ${types}`
          : `tags=${config.tag} AND ${types}`,
      )
      .with_field('context')
      .with_field('tags')
      .sort_by('created_at', 'desc')
      .max_results(publicId !== null ? 10 : limit);
    if (publicId === null && cursor && /^[A-Za-z0-9+/=_-]{1,512}$/.test(cursor)) query = query.next_cursor(cursor);
    const result = (await query.execute()) as { resources?: SearchResource[]; next_cursor?: string; total_count?: number };

    const resources: CloudResource[] = (result.resources ?? [])
      .filter((r) => r.resource_type === 'image' || r.resource_type === 'video')
      // Search's `=` is exact, but keep the guarantee local: only the requested public ID comes back.
      .filter((r) => publicId === null || r.public_id === publicId)
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
      {
        cloudName: config.cloudName,
        tag: config.tag,
        resources,
        nextCursor: publicId !== null ? null : (result.next_cursor ?? null),
        total: publicId !== null ? resources.length : (result.total_count ?? resources.length),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const { message, status } = cloudinaryErrorMessage(error);
    return jsonError(status === 401 || status === 403 ? 502 : status, `Cloudinary search failed: ${message}`);
  }
}
