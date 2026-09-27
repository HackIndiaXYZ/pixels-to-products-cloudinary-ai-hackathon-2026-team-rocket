import { DEFAULT_SCOPE, buildReport, evidenceStillUrl } from '@/lib/report';
import { LANDING_ASSETS, landingAsset } from '../landing-data';

/**
 * The one report the Evidence section prints: the console's inspection report
 * for VO-1036, the PPE check at Building B. It is a photo with people in frame,
 * so Cloudinary's face pixelation (e_pixelate_faces) is visibly at work in the
 * evidence frame — and it is a different record from the one the story follows.
 */
export const REPORT_ASSET = landingAsset('vo-crew-ppe');

/** Width of the evidence frame rendition on the paper. */
export const REPORT_FRAME_WIDTH = 900;

/**
 * The evidence frame exactly as a report builds it: exposure correction, face
 * pixelation and the audit stamp. Sample media stamps `SAMPLE` instead of a
 * date, so the URL is the same for every viewer and can render on the server.
 */
export const REPORT_FRAME_URL = evidenceStillUrl(REPORT_ASSET, true, REPORT_FRAME_WIDTH);

/** Same fixed clock as the landing dataset, so the report model is deterministic. */
const REPORT_CLOCK = Date.UTC(2026, 8, 26, 9, 0, 0);

/** The report the console would build for this one finding, faces redacted. */
export const REPORT_MODEL = buildReport(
  'inspection',
  LANDING_ASSETS,
  { ...DEFAULT_SCOPE, assetIds: [REPORT_ASSET.id], redactFaces: true },
  REPORT_CLOCK,
);
