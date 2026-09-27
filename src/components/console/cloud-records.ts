import type { MediaAsset } from '@/lib/types';
import type { BackendConfig } from '@/lib/cloudinary/backend';
import type { ConsoleData } from './store';

/**
 * Keeping the console's records in step with Cloudinary after the Inspector or the ingest sheet
 * changed one (AI analysis, removal). The store's in-place record updates are used when it has
 * them; otherwise the records are re-read from Cloudinary.
 */

/** The in-place record actions the store may expose (ConsoleData.updateCloudAsset / removeCloudAsset). */
interface CloudRecordActions {
  updateCloudAsset?: (asset: MediaAsset) => void;
  removeCloudAsset?: (id: string) => void;
}

function actionsOf(data: ConsoleData): CloudRecordActions {
  const maybe = data as ConsoleData & CloudRecordActions;
  return {
    updateCloudAsset: typeof maybe.updateCloudAsset === 'function' ? maybe.updateCloudAsset : undefined,
    removeCloudAsset: typeof maybe.removeCloudAsset === 'function' ? maybe.removeCloudAsset : undefined,
  };
}

/** How long Cloudinary’s Search index usually takes to return a context write. */
const READ_BACK_DELAY_MS = 4000;

/** Whether the record lives in the team's Cloudinary cloud that the VisualOps server is connected to. */
export function isTeamCloudRecord(asset: MediaAsset, backend: BackendConfig | null): boolean {
  return Boolean(backend?.configured && backend.cloudName && asset.cloudName === backend.cloudName);
}

/**
 * Puts an updated record (e.g. after Cloudinary AI analysis) on screen at once: replaced in place in the
 * cloud records, and in this browser's cached copy when there is one. Without the store's in-place update,
 * falls back to re-reading the records from Cloudinary.
 */
export function applyRecordUpdate(data: ConsoleData, asset: MediaAsset): void {
  const { updateCloudAsset } = actionsOf(data);
  // The store's in-place update covers this browser's cached copy too; without it, refresh that copy here.
  if (updateCloudAsset) updateCloudAsset(asset);
  else if (data.userAssets.some((a) => a.id === asset.id)) data.addUserAssets([asset]);
  if (!data.backend?.configured) return;
  if (!updateCloudAsset) {
    void data.refreshCloud().catch(() => undefined);
  } else if (asset.source === 'sample') {
    // Team-written sample records (provenance sample-annotation) live in the cloud too, but an in-place update
    // may treat source 'sample' as a bundled sample and skip it: read the record back once the Search index
    // has the write, so the library shows the result as well.
    window.setTimeout(() => void data.refreshCloud().catch(() => undefined), READ_BACK_DELAY_MS);
  }
}

/** Drops a record the server just took out of the workspace (untagged), here and in the browser cache. */
export function applyRecordRemoval(data: ConsoleData, id: string): void {
  const { removeCloudAsset } = actionsOf(data);
  if (removeCloudAsset) {
    removeCloudAsset(id); // drops the cached local copy as well
    return;
  }
  data.removeUserAsset(id);
  if (data.backend?.configured) void data.refreshCloud().catch(() => undefined);
}
