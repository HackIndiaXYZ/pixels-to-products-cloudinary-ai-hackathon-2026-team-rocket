import type { MediaAsset, Severity } from '@/lib/types';
import { CATEGORY_LABEL, SEVERITY_RANK } from '@/lib/analytics';
import { landingAsset } from '../landing-data';
import { megapixels } from './media-sources';

/**
 * Operating domains shown in the Solutions section. Every asset listed is a
 * real capture from the sample dataset on Cloudinary's demo cloud; the facts
 * printed beside each domain are computed from those records, never typed in.
 * Every field capture appears in exactly one domain (plant and maintenance
 * footage is filed with facilities).
 */

export interface Domain {
  key: string;
  anchor: string;
  title: string;
  sentence: string;
  assetIds: string[];
}

const label = landingAsset('vo-receiving-label');
const crib = landingAsset('vo-tool-crib');

export const DOMAINS: Domain[] = [
  {
    key: 'construction',
    anchor: 'solutions-construction',
    title: 'Construction & renovation',
    sentence:
      'Drone passes and phone photos from live sites, filed against the building, the zone and the finding each frame proves.',
    assetIds: ['vo-demolition-deck', 'vo-crew-ppe'],
  },
  {
    key: 'infrastructure',
    anchor: 'solutions-infrastructure',
    title: 'Infrastructure',
    sentence:
      'Patrol and survey imagery of roads, bridges and overhead lines, graded so a carriageway void never waits behind a routine baseline.',
    assetIds: ['vo-road-collapse', 'vo-ole-survey', 'vo-bridge-truss'],
  },
  {
    key: 'facilities',
    anchor: 'solutions-facilities',
    title: 'Facilities & plant',
    sentence:
      'Maintenance jobs, cleaning rounds, overnight CCTV and shop-floor footage in one record, with the frame that matters pulled out by Cloudinary.',
    assetIds: ['vo-hot-work', 'vo-washroom-panel', 'vo-cctv-kitchen', 'vo-wet-floor', 'vo-plant-walkthrough'],
  },
  {
    key: 'fleet',
    anchor: 'solutions-fleet',
    title: 'Fleet & equipment',
    sentence:
      'Gate check-ins, pre-trip dashboards and yard sweeps, each tied to a site and a next action before a vehicle goes back out.',
    assetIds: ['vo-fleet-checkin', 'vo-fleet-dash', 'vo-equipment-yard'],
  },
  {
    key: 'stores',
    anchor: 'solutions-stores',
    title: 'Stores & inventory',
    sentence: `A goods-in label at ${megapixels(label)} megapixels and a tool-crib snapshot at ${megapixels(crib)}: both indexed, both labelled with what they can and cannot prove.`,
    assetIds: ['vo-receiving-label', 'vo-tool-crib'],
  },
];

export interface DomainFacts {
  /** Findings in the domain, worst first (sample annotations). */
  findings: Array<{ id: string; severity: Severity }>;
  /** Severity of the worst finding, if any. */
  worst?: Severity;
  sites: string[];
  categories: string[];
  media: string;
  count: number;
}

export function domainAssets(domain: Domain): MediaAsset[] {
  return domain.assetIds.map(landingAsset);
}

export function domainFacts(domain: Domain): DomainFacts {
  const assets = domainAssets(domain);
  const findings = assets
    .flatMap((a) => (a.finding ? [{ id: a.finding.id, severity: a.finding.severity }] : []))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const videos = assets.filter((a) => a.resourceType === 'video').length;
  const photos = assets.length - videos;
  const media = [
    videos ? `${videos} video${videos === 1 ? '' : 's'}` : '',
    photos ? `${photos} photo${photos === 1 ? '' : 's'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    findings,
    worst: findings[0]?.severity,
    sites: Array.from(new Set(assets.map((a) => a.site))),
    categories: Array.from(new Set(assets.flatMap((a) => (a.finding ? [CATEGORY_LABEL[a.finding.category]] : [])))),
    media,
    count: assets.length,
  };
}
