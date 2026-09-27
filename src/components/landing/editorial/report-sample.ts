import { DEFAULT_SCOPE, REPORT_EVIDENCE_WIDTH, buildReport, evidenceStillUrl, reportPayload } from '@/lib/report';
import { LANDING_ASSETS, landingAsset } from '../landing-data';

/**
 * The one report the Evidence section prints: the console's inspection report
 * for VO-1036, the PPE check at Building B. It is a photo with people in frame,
 * so Cloudinary's face pixelation (e_pixelate_faces) is visibly at work in the
 * evidence frame — and it is a different record from the one the story follows.
 */
export const REPORT_ASSET = landingAsset('vo-crew-ppe');

/** Width of the evidence frame rendition on the paper — the width the console's reports render and export. */
export const REPORT_FRAME_WIDTH = REPORT_EVIDENCE_WIDTH;

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

/**
 * The sample report payload the paper's SHA-256 is computed over: the console's own export builder, fixed
 * clock, sample annotation — and, as its evidence, exactly the frame URL the paper displays. The landing does
 * not run a report, so the payload records the frame as not requested (no delivery result, no face count)
 * instead of inventing one.
 */
export const REPORT_PAYLOAD = reportPayload(REPORT_MODEL, {
  evidence: Object.fromEntries(
    REPORT_MODEL.records.filter((r) => r.asset.id === REPORT_ASSET.id).map((r) => [r.finding.id, { url: REPORT_FRAME_URL }]),
  ),
  fileName: 'visualops-sample-report.json',
});

/** The exact text that is hashed. */
export const REPORT_PAYLOAD_JSON = JSON.stringify(REPORT_PAYLOAD, null, 2);
