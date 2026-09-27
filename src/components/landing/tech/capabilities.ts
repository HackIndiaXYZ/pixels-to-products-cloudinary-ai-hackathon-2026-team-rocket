import type { MediaAsset } from '@/lib/types';
import type { Integrity } from '@/lib/cloudinary/pipeline';
import { displayUrl, frameUrl, originalUrl, redactedUrl, refOf } from '@/lib/cloudinary/media';
import { component, deliveryUrl } from '@/lib/cloudinary/url';
import { landingAsset } from '../landing-data';

/**
 * The capability explorer: eight real Cloudinary transformations, each applied
 * to a sample asset. Every URL here is requested from Cloudinary only when its
 * capability is selected.
 */

export type CapabilityMode = 'compare' | 'crop' | 'frames' | 'highlight';

export interface Capability {
  id: string;
  title: string;
  /** The transformation component this capability demonstrates. */
  code: string;
  integrity: Integrity;
  summary: string;
  /** A second, quieter line (caveats, what to look for). */
  note?: string;
  asset: MediaAsset;
  mode: CapabilityMode;
  /** Input rendition shown on the "before" side. */
  before?: string;
  /** Output URL: previewed, measured and linked (frames mode: the default frame). */
  after: string;
  /** Components of the output URL to highlight. */
  focus: string[];
  /** Stage label for the input side (defaults to "Original"). */
  beforeLabel?: string;
  afterLabel: string;
  /** Transparent output: show a checkerboard behind it. */
  checker?: boolean;
  /** Measure the "before" rendition too (byte comparison). */
  measureBefore?: boolean;
  /** Overlay Cloudinary's detected faces on the "before" side. */
  faces?: boolean;
  /** fl_getinfo URL for the exact crop (crop mode). */
  getInfoUrl?: string;
  /** Output aspect (crop mode), as width / height. */
  outputAspect?: number;
  /** Output aspect (crop mode) as written in the URL, e.g. "9:16". */
  outputRatio?: string;
  /** Offsets in seconds (frames and highlight modes). */
  offsets?: number[];
}

/** Frame renditions used in the frames / highlight modes. */
export const FRAME_W = 1280;
export const FRAME_H = 720;
export const frameStill = (asset: MediaAsset, seconds: number) => frameUrl(asset, seconds, FRAME_W, FRAME_H);
export const frameThumb = (asset: MediaAsset, seconds: number) => frameUrl(asset, seconds, 256, 144);

const GEN_REPLACE = 'e_gen_replace:from_mop;to_yellow%20wet%20floor%20warning%20sign';

function build(): Capability[] {
  const bridge = landingAsset('vo-bridge-truss');
  const crew = landingAsset('vo-crew-ppe');
  const tools = landingAsset('vo-tool-crib');
  const truck = landingAsset('vo-fleet-checkin');
  const wet = landingAsset('vo-wet-floor');
  const drone = landingAsset('vo-demolition-deck');
  const yard = landingAsset('vo-equipment-yard');
  const label = landingAsset('vo-receiving-label');

  // 432 px is the widest 9:16 window a 768 px-tall frame holds, so the crop is never upscaled.
  const vertical = component({ ar: '9:16', c: 'fill', g: 'auto', w: 432 });
  const limit1200 = component({ c: 'limit', w: 1200 });
  const highlight = 'e_preview:duration_6';

  return [
    {
      id: 'crop',
      title: 'Subject-aware crop',
      code: 'g_auto',
      integrity: 'evidence',
      summary: `A ${bridge.width} × ${bridge.height} bridge survey photo reframed to 9:16 for a vertical briefing. Cloudinary’s g_auto decides where the window sits — here over the truss members and the train.`,
      note: 'The dashed window is the g_auto crop from Cloudinary’s own fl_getinfo response for this exact URL. Its size follows the 9:16 ratio; only its position is Cloudinary’s choice.',
      asset: bridge,
      mode: 'crop',
      before: displayUrl(bridge, 800),
      after: deliveryUrl(refOf(bridge), [vertical, 'q_auto', 'f_auto']),
      getInfoUrl: deliveryUrl(refOf(bridge), [vertical, 'fl_getinfo']),
      outputAspect: 9 / 16,
      outputRatio: '9:16',
      focus: [vertical],
      afterLabel: '9:16 crop',
    },
    {
      id: 'faces',
      title: 'Face redaction',
      code: 'e_pixelate_faces',
      integrity: 'evidence',
      summary: 'Faces Cloudinary detects are pixelated before an image leaves the team. Nothing else in the frame changes.',
      note: 'Boxes on the original side are Cloudinary’s face detections (fl_getinfo), fetched live. Detection can miss people, so check before sharing.',
      asset: crew,
      mode: 'compare',
      before: displayUrl(crew, 1200),
      after: redactedUrl(crew, 1200),
      focus: ['e_pixelate_faces:20'],
      afterLabel: 'e_pixelate_faces',
      faces: true,
    },
    {
      id: 'upscale',
      title: 'AI upscale',
      code: 'e_upscale',
      integrity: 'generative',
      summary: 'A 328 px tool-crib scan enlarged four-fold for identification. The left side is the stored file, stretched by your browser.',
      note: 'Upscaling synthesises detail, so VisualOps labels it Generative and never files it as evidence.',
      asset: tools,
      mode: 'compare',
      before: originalUrl(tools),
      after: deliveryUrl(refOf(tools), ['e_upscale', 'q_auto', 'f_auto']),
      focus: ['e_upscale'],
      beforeLabel: 'Stored file · 328 px',
      afterLabel: 'Generative · e_upscale',
    },
    {
      id: 'background',
      title: 'Background removal',
      code: 'e_background_removal',
      integrity: 'ai-edit',
      summary:
        'The truck and the crew member beside it cut out from the gate for a fleet register — note the windscreen, where glass reads as background. AI selects existing pixels; it invents none.',
      note: 'Labelled as an AI edit wherever it is shared. The original remains the record.',
      asset: truck,
      mode: 'compare',
      before: displayUrl(truck, 1200),
      after: deliveryUrl(refOf(truck), ['e_background_removal', limit1200, 'q_auto', 'f_auto']),
      focus: ['e_background_removal'],
      afterLabel: 'AI edit · e_background_removal',
      checker: true,
    },
    {
      id: 'remediation',
      title: 'Remediation preview',
      code: 'e_gen_replace',
      integrity: 'generative',
      summary: 'Generative replace shows the corrective action for a toolbox talk: a wet-floor marker generated in place of the mop in use.',
      note: 'Look at the marker’s lettering — it is synthesised. That is why generative output is a briefing aid, never a record.',
      asset: wet,
      mode: 'compare',
      before: deliveryUrl(refOf(wet), ['q_auto', 'f_auto']),
      after: deliveryUrl(refOf(wet), [GEN_REPLACE, 'q_auto', 'f_auto']),
      focus: [GEN_REPLACE],
      afterLabel: 'Generative · e_gen_replace',
    },
    {
      id: 'frames',
      title: 'Frames from footage',
      code: 'so_',
      integrity: 'evidence',
      summary: 'Any second of a drone pass becomes an inspection still. Pick an offset: Cloudinary extracts that frame on request.',
      note: 'No video tooling on our side — the start offset is a URL component.',
      asset: drone,
      mode: 'frames',
      after: frameStill(drone, 10),
      offsets: [2, 6, 10, 14, 18],
      focus: [],
      afterLabel: 'Frame',
    },
    {
      id: 'highlight',
      title: 'AI video highlights',
      code: 'e_preview',
      integrity: 'ai-edit',
      summary: 'Ninety seconds of yard footage condensed into a six-second highlight. Cloudinary’s model chooses which moments to keep.',
      note: 'An AI edit: it selects footage, it does not create any. Frames on the left are the source, extracted by Cloudinary.',
      asset: yard,
      mode: 'highlight',
      after: deliveryUrl(refOf(yard), [highlight, component({ c: 'limit', w: 960 }), 'ac_none', 'q_auto', 'vc_auto'], 'mp4'),
      offsets: [6, 24, 42, 60, 78],
      focus: [highlight],
      afterLabel: 'AI edit · e_preview',
    },
    {
      id: 'delivery',
      title: 'Automatic delivery',
      code: 'q_auto,f_auto',
      integrity: 'evidence',
      summary: 'The same 1200 px receiving-dock photo, twice: as a plain JPEG, and with quality and format negotiated for this browser.',
      note: 'Drag across the frame and look for the difference. The byte counts are Cloudinary’s own.',
      asset: label,
      mode: 'compare',
      before: deliveryUrl(refOf(label), [limit1200]),
      after: displayUrl(label, 1200),
      focus: ['q_auto', 'f_auto'],
      beforeLabel: 'Plain JPEG',
      afterLabel: 'q_auto · f_auto',
      measureBefore: true,
    },
  ];
}

export const CAPABILITIES: Capability[] = build();
