import { serverConfig } from '@/lib/server/cloudinary';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cloudinary/config — which Cloudinary cloud the server is connected to.
 * Public values only (cloud name, preset name, tag). No API key or secret.
 */
export async function GET() {
  const config = serverConfig();
  return Response.json(
    config
      ? { configured: true, cloudName: config.cloudName, uploadPreset: config.uploadPreset ?? null, tag: config.tag, signedUploads: true }
      : { configured: false },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
