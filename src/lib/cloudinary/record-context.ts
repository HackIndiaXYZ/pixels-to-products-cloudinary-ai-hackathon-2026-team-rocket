/**
 * The VisualOps record contract: which Cloudinary contextual-metadata keys hold which record
 * fields. Cloudinary is the system of record — every key below lives on the asset itself and is
 * returned by the Search API (GET /api/assets). No database.
 *
 * HUMAN CLASSIFIED (entered at ingest, or team-written for the sample workspace):
 *   title, finding_title, site, zone, category, severity, status, note (finding summary), action,
 *   finding_id, captured_by, file_name, region ("x,y,w,h" in percent, optional ",LABEL"),
 *   poster_offset (video, seconds)
 * PROVENANCE:
 *   source      = "visualops" for records created by VisualOps (ingest or seed)
 *   provenance  = "sample-annotation" (team-written sample workspace) | "ingest" (entered at upload)
 * CAPTURE TIME:
 *   sample_hours_ago = N   → sample workspace: capture time materialised as now − N hours (labelled sample time)
 *   captured_at      = ISO → a fixed capture time (e.g. burned into CCTV footage)
 *   camera_time      = "YYYY-MM-DD HH:MM:SS" as shown in frame (with captured_at)
 *   (neither)             → Cloudinary's created_at (upload time)
 * AI DETECTED (written by POST /api/assets/[id]/analyze from Cloudinary AI Content Analysis):
 *   ai_caption, ai_objects ("label|confidence|x,y,w,h;…" boxes in percent), ai_tags ("a,b"),
 *   ai_model, analyzed_at
 * Tags on the asset: the VisualOps tag (collection), category, site slug, human tags, and the
 * tags Cloudinary's auto_tagging adds (listed again in ai_tags so the UI can label them).
 */

export const CTX = {
  title: 'title',
  /** The finding's own headline when it differs from the media title (sample workspace). */
  findingTitle: 'finding_title',
  site: 'site',
  zone: 'zone',
  category: 'category',
  severity: 'severity',
  status: 'status',
  note: 'note',
  action: 'action',
  findingId: 'finding_id',
  capturedBy: 'captured_by',
  fileName: 'file_name',
  region: 'region',
  posterOffset: 'poster_offset',
  source: 'source',
  provenance: 'provenance',
  sampleHoursAgo: 'sample_hours_ago',
  capturedAt: 'captured_at',
  cameraTime: 'camera_time',
  aiCaption: 'ai_caption',
  aiObjects: 'ai_objects',
  aiTags: 'ai_tags',
  aiModel: 'ai_model',
  analyzedAt: 'analyzed_at',
} as const;

export type Provenance = 'sample-annotation' | 'ingest';
