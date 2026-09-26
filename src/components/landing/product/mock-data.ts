import { overviewSummary } from '@/lib/analytics';
import { buildSampleAssets } from '@/lib/data/dataset';

/**
 * The preview's clock. Sample capture times are generated relative to "now", so
 * an age computed against this clock ("5h ago") is exactly the age the console
 * shows against the viewer's clock — and server and client render the same text.
 */
export const MOCK_NOW = Date.UTC(2026, 8, 26, 9, 0, 0);

/**
 * Everything the product preview shows is derived from the sample dataset the
 * console loads, through the very helper the console's Command Center uses
 * (overviewSummary). Nothing is typed in by hand, so the preview and /console
 * cannot disagree: "open" is status 'open' in both, and the sites in the summary
 * sentence are sites with an open finding, as in the console.
 */
const summary = overviewSummary(buildSampleAssets(MOCK_NOW));
const photos = summary.field.filter((a) => a.resourceType === 'image').length;

export const MOCK = {
  ...summary,
  /** Field captures (reference samples excluded). */
  fieldCount: summary.field.length,
  photos,
  videos: summary.field.length - photos,
};
