export type ResourceType = 'image' | 'video';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type Category =
  | 'structural'
  | 'safety'
  | 'equipment'
  | 'electrical'
  | 'facilities'
  | 'inventory';

export type FindingStatus = 'open' | 'monitoring' | 'resolved';

/** Where an asset came from: the bundled sample set, an upload made in this browser, or a tag sync from Cloudinary. */
export type AssetSource = 'sample' | 'upload' | 'sync';

/**
 * How an asset's `capturedAt` was obtained.
 * - `sample-relative`: a bundled sample whose time is stored as an offset and materialised
 *   against the viewer's clock when the console loads. Illustrative, not a real capture time.
 * - `fixed`: a bundled sample whose time is read from the media itself (a timestamp burned
 *   into the footage); see `MediaAsset.cameraTime`.
 * - `recorded`: the time Cloudinary recorded for an upload or a synced resource.
 */
export type CaptureBasis = 'sample-relative' | 'fixed' | 'recorded';

/** A rectangle in percent of the media frame (0–100). */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

/** A structured observation attached to a piece of media. */
export interface Finding {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  status: FindingStatus;
  /** What is visible in the media. */
  summary: string;
  /** What should happen next. */
  action: string;
  /** Annotated region in the original frame (or the poster frame for video). */
  region?: Region;
}

/** An object Cloudinary's AI detected in the frame. `box` is in percent of the frame (0–100). */
export interface AiObject {
  label: string;
  /** 0–1, as returned by Cloudinary. */
  confidence: number;
  box?: Region;
}

/**
 * What Cloudinary's AI (AI Content Analysis add-on: captioning + object detection with
 * auto-tagging) returned for an asset. Always machine-generated — label it "AI detected".
 */
export interface AiUnderstanding {
  caption?: string;
  objects: AiObject[];
  /** Tags Cloudinary added automatically (auto_tagging). */
  tags: string[];
  /** e.g. "captioning v6 · coco v2". */
  model?: string;
  analyzedAt?: string;
}

export interface MediaAsset {
  id: string;
  cloudName: string;
  publicId: string;
  resourceType: ResourceType;
  /** Original format as stored in Cloudinary. */
  format: string;
  width: number;
  height: number;
  /** Original size in bytes, when known. */
  bytes?: number;
  /** Duration in seconds for video. */
  duration?: number;
  /** For video: the offset (seconds) used for poster frames and stills. */
  posterOffset?: number;
  /** Capture file name as it arrived from the field. */
  fileName: string;
  title: string;
  site: string;
  zone?: string;
  /** ISO timestamp of capture. See `captureBasis` for how it was obtained. */
  capturedAt: string;
  /**
   * How `capturedAt` was obtained. When absent: 'sample-relative' for samples, 'recorded'
   * otherwise (use `captureBasisOf()` from lib/analytics).
   */
  captureBasis?: CaptureBasis;
  /**
   * For `fixed` times: the wall-clock time burned into the footage, exactly as shown in frame
   * (camera-local, no time zone), e.g. "2025-10-03 03:48:49". Show this rather than a converted instant.
   */
  cameraTime?: string;
  capturedBy: string;
  tags: string[];
  source: AssetSource;
  /**
   * `field`: operational media (the product's subject).
   * `reference`: generic Cloudinary sample assets kept for trying transformations.
   */
  collection?: 'field' | 'reference';
  finding?: Finding;
  /** Cloudinary AI understanding of the media, when it has been analysed. */
  ai?: AiUnderstanding;
}

export interface CloudSettings {
  cloudName: string;
  uploadPreset: string;
  tag: string;
}
