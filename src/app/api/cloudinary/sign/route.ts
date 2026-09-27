import { encodeContext, sanitizeIngestContext, sanitizeTags } from '@/lib/cloudinary/ingest-fields';
import {
  cloudinaryFor,
  isSameOrigin,
  jsonError,
  metadataFieldsReady,
  NOT_CONFIGURED,
  rateLimited,
  serverConfig,
  structuredMetadataParam,
} from '@/lib/server/cloudinary';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4096;

/**
 * POST /api/cloudinary/sign — signs one upload to the team's Cloudinary cloud.
 *
 * The browser sends the record fields it wants attached (tags + context). The server
 * validates them, pins the VisualOps tag and the signed upload preset, adds a timestamp
 * and signs the exact parameter set with the API secret (Cloudinary's api_sign_request).
 * The browser then uploads the file directly to Cloudinary with those parameters, so file
 * bytes never pass through this server and the secret never reaches the browser.
 *
 * When the cloud has the VisualOps structured metadata fields (created by `npm run setup:cloudinary`),
 * the same validated values are also signed as structured metadata (`metadata` parameter):
 * vo_category, vo_severity, vo_status (open, for a new finding) and vo_site. Without the fields the
 * parameter is simply left out, so uploads never depend on them.
 *
 * Body: { tags?: string[], context?: { title, site, category, severity, note, finding_id, source } }
 * 200:  { cloudName, apiKey, signature, params }  — send `params` + api_key + signature + file
 */
export async function POST(request: Request) {
  const config = serverConfig();
  if (!config) return jsonError(503, NOT_CONFIGURED, { configured: false });
  if (!isSameOrigin(request)) return jsonError(403, 'Uploads can only be signed for this site.');
  if (rateLimited(request, 'sign', 60, 10 * 60 * 1000)) return jsonError(429, 'Too many uploads from this address. Try again in a few minutes.');

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return jsonError(413, 'Request too large.');
  let body: { tags?: unknown; context?: unknown };
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return jsonError(400, 'Request body must be JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError(400, 'Request body must be a JSON object.');

  const tags = Array.from(new Set([config.tag, ...sanitizeTags(body.tags)]));
  const context = sanitizeIngestContext(body.context);

  // Every parameter except file, cloud_name, resource_type and api_key must be signed.
  const params: Record<string, string> = {
    timestamp: String(Math.round(Date.now() / 1000)),
    tags: tags.join(','),
  };
  const encoded = encodeContext({ ...context });
  if (encoded) params.context = encoded;
  if (config.uploadPreset) params.upload_preset = config.uploadPreset;

  // Structured metadata, only from the validated context and only when every field exists on the cloud.
  if (await metadataFieldsReady(config)) {
    const metadata = structuredMetadataParam({
      category: context.category,
      severity: context.severity,
      // A record with a severity is a new finding; findings start open.
      status: context.severity ? 'open' : undefined,
      site: context.site,
    });
    if (metadata) params.metadata = metadata;
  }

  const signature = cloudinaryFor(config).utils.api_sign_request(params, config.apiSecret);
  return Response.json(
    { cloudName: config.cloudName, apiKey: config.apiKey, signature, params },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
