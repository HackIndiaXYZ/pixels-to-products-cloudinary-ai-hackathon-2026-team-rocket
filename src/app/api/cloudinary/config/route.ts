import { metadataFieldsReady, serverConfig } from '@/lib/server/cloudinary';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cloudinary/config — which Cloudinary cloud the server is connected to.
 * Public values only (cloud name, preset name, tag, whether the VisualOps structured metadata
 * fields exist). No API key or secret.
 */
export async function GET() {
  const config = serverConfig();
  if (!config) return Response.json({ configured: false }, { headers: { 'Cache-Control': 'no-store' } });
  // Cached on the server (see metadataFieldsReady), so this costs at most one Admin API call per few minutes.
  const structuredMetadata = await metadataFieldsReady(config);
  return Response.json(
    {
      configured: true,
      cloudName: config.cloudName,
      uploadPreset: config.uploadPreset ?? null,
      tag: config.tag,
      signedUploads: true,
      structuredMetadata,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
