import 'server-only';
import type { ResourceType } from '@/lib/types';
import { cloudinaryErrorMessage, cloudinaryFor, jsonError, type ServerCloudinaryConfig } from '@/lib/server/cloudinary';

/**
 * Shared guards for the per-asset routes (POST /api/assets/[id]/analyze, DELETE /api/assets/[id]).
 * Not a route file: Next.js only serves route.ts, so this module is private to the folder.
 */

/** Public IDs these routes accept: letters, digits, `_ - . /` (folders), nothing Cloudinary would need escaped. */
const PUBLIC_ID = /^[A-Za-z0-9_\-/.]{1,255}$/;

/** The `[id]` segment → a Cloudinary public_id, or null when it is not one VisualOps would have created. */
export function parsePublicId(raw: string | undefined): string | null {
  if (!raw) return null;
  let id: string;
  try {
    // The browser sends encodeURIComponent(public_id); decoding an already-decoded id is a no-op for valid ids.
    id = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!PUBLIC_ID.test(id)) return null;
  if (id.includes('..') || id.includes('//') || id.startsWith('/') || id.endsWith('/')) return null;
  return id;
}

export function parseResourceType(value: unknown): ResourceType | null {
  return value === 'image' || value === 'video' ? value : null;
}

/** A small JSON body (or none). Returns the parsed object, or an error response. */
export async function readJsonBody(request: Request, maxBytes = 1024): Promise<{ body: Record<string, unknown> } | { error: Response }> {
  const raw = await request.text().catch(() => '');
  if (raw.length > maxBytes) return { error: jsonError(413, 'Request too large.') };
  if (!raw.trim()) return { body: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: jsonError(400, 'Request body must be a JSON object.') };
    return { body: parsed as Record<string, unknown> };
  } catch {
    return { error: jsonError(400, 'Request body must be JSON.') };
  }
}

/** The fields of an Admin API resource (GET resources/… or POST resources/… update) these routes read. */
export interface AdminResource {
  public_id: string;
  resource_type?: string;
  width?: number;
  height?: number;
  tags?: string[];
  /** Admin API: `{ custom: { key: value } }`. */
  context?: Record<string, unknown>;
  info?: { detection?: Record<string, unknown> };
}

/** The asset's contextual metadata as a flat string map (Admin API nests it under `custom`). */
export function customContext(resource: AdminResource): Record<string, string> {
  const context = resource.context;
  if (!context) return {};
  const source = (context.custom && typeof context.custom === 'object' ? context.custom : context) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) if (typeof v === 'string') out[k] = v;
  return out;
}

/** A Cloudinary failure as a structured, secret-free response: 404 stays 404, anything else is a 502 from upstream. */
export function cloudinaryFailure(error: unknown, prefix: string): Response {
  const { message, status } = cloudinaryErrorMessage(error);
  if (status === 404) return jsonError(404, `${prefix}: no such asset in this Cloudinary cloud.`);
  return jsonError(502, `${prefix}: ${message}`);
}

/**
 * Reads the asset with the Admin API and checks it carries the VisualOps tag, so these routes can
 * never act on media in the cloud that VisualOps does not manage.
 */
export async function loadVisualOpsAsset(
  config: ServerCloudinaryConfig,
  publicId: string,
  resourceType: ResourceType,
): Promise<{ resource: AdminResource } | { error: Response }> {
  try {
    const resource = (await cloudinaryFor(config).api.resource(publicId, { resource_type: resourceType, type: 'upload' })) as AdminResource;
    if (!(resource.tags ?? []).includes(config.tag)) {
      return { error: jsonError(403, `This asset is not a VisualOps record: it does not carry the “${config.tag}” tag.`) };
    }
    return { resource };
  } catch (error) {
    return { error: cloudinaryFailure(error, 'Could not read the asset from Cloudinary') };
  }
}

export const NO_STORE = { headers: { 'Cache-Control': 'no-store' } } as const;
