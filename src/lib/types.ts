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
  /** ISO timestamp of capture. */
  capturedAt: string;
  capturedBy: string;
  tags: string[];
  source: AssetSource;
  /**
   * `field`: operational media (the product's subject).
   * `reference`: generic Cloudinary sample assets kept for trying transformations.
   */
  collection?: 'field' | 'reference';
  finding?: Finding;
}

export interface CloudSettings {
  cloudName: string;
  uploadPreset: string;
  tag: string;
}
