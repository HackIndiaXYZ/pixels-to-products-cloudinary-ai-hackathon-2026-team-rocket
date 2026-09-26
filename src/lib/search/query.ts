import type { Category, FindingStatus, MediaAsset, ResourceType, Severity } from '@/lib/types';

/**
 * Ask VisualOps — a transparent query parser.
 *
 * Plain-language questions are turned into explicit filters (severity,
 * category, site, time window, media type, status) plus free-text keywords
 * that are matched against each record's tags, title, finding and file name.
 * There is no language model here: the interpretation is shown to the user as
 * chips so they can see exactly how the question was understood.
 */

export interface DateWindow {
  from: number;
  to: number;
  label: string;
}

export interface ParsedQuery {
  raw: string;
  severities: Severity[];
  categories: Category[];
  sites: string[];
  mediaTypes: ResourceType[];
  statuses: FindingStatus[];
  window?: DateWindow;
  keywords: string[];
  /** Tokens the parser recognised and consumed (for highlighting). */
  understood: string[];
}

const SEVERITY_WORDS: Array<[RegExp, Severity[]]> = [
  [/\b(critical|crit)\b/, ['critical']],
  [/\bhigh[- ]?(severity|risk|priority)?\b/, ['high']],
  [/\b(medium|moderate)\b/, ['medium']],
  [/\blow[- ]?(severity|risk|priority)?\b/, ['low']],
  [/\b(urgent|severe|serious|major|dangerous)\b/, ['critical', 'high']],
];

const CATEGORY_WORDS: Array<[RegExp, Category]> = [
  [/\b(structural|structure|structures|foundation|slab|beam|bridge|bridges|sinkhole|collapse|rebar|concrete|infrastructure|corrosion|rust|rusted)\b/, 'structural'],
  [/\b(safety|ppe|hazard|hazards|unsafe|slip|trip|fall|falls|harness|helmet|helmets|hard hats?|hot[- ]work|permit)\b/, 'safety'],
  [/\b(equipment|machinery|machine|machines|vehicle|vehicles|fleet|truck|trucks|plant equipment|excavator|pipelayers?|dashboard|mechanical)\b/, 'equipment'],
  [/\b(electrical|electric|power|cable|cables|overhead line|catenary|ole|transformer|substation)\b/, 'electrical'],
  [/\b(facilit(y|ies)|building services|plumbing|washroom|toilet|housekeeping|cleaning|kitchen|cctv)\b/, 'facilities'],
  [/\b(inventory|stock|stores|parts?|tools?|receiving|goods[- ]in|label|labels)\b/, 'inventory'],
];

const STATUS_WORDS: Array<[RegExp, FindingStatus[]]> = [
  [/\b(open|unresolved|outstanding|pending|active)\b/, ['open']],
  [/\b(monitor(ing|ed)?|watch(list)?)\b/, ['monitoring']],
  [/\b(resolved|closed|fixed|compliant|done)\b/, ['resolved']],
];

const MEDIA_WORDS: Array<[RegExp, ResourceType]> = [
  [/\b(photos?|images?|pictures?|pics?|stills?|snapshots?)\b/, 'image'],
  [/\b(videos?|clips?|footage|recordings?|cctv|drone footage)\b/, 'video'],
];

const STOPWORDS = new Set(
  (
    'show me all any the a an of in on at from for with within containing contain contains that which ' +
    'have has had is are was were be find list give get display what where who whose please issues issue ' +
    'problems problem findings finding media assets asset evidence items records record inspection inspections ' +
    'and or to by near about this last past week weeks today yesterday month months day days hours hour ' +
    'visual data photo photos image images video videos clips clip footage sites site location locations'
  ).split(' '),
);

const SYNONYMS: Record<string, string[]> = {
  crack: ['crack', 'cracking', 'fracture', 'broken-concrete', 'collapse'],
  damage: ['damage', 'damaged', 'broken', 'collapse', 'crack', 'corrosion', 'dent'],
  damaged: ['damage', 'damaged', 'broken', 'collapse', 'crack', 'corrosion', 'dent'],
  leak: ['leak', 'leaking', 'water', 'fluid', 'wet'],
  rust: ['rust', 'corrosion', 'coating'],
  construction: ['construction', 'demolition', 'scaffold', 'rebar', 'site'],
  wet: ['wet', 'wet-floor', 'slip-hazard'],
  weld: ['weld', 'welding', 'hot-work'],
  drone: ['drone', 'aerial'],
  plate: ['plate', 'registration'],
};

function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('es') && /(ss|sh|ch|x)es$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function detectWindow(q: string, now: number): { window?: DateWindow; matched?: string } {
  const DAY = 86_400_000;
  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const m = q.match(/\b(?:last|past)\s+(\d{1,3})\s*(hours?|days?|weeks?)\b/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2].startsWith('hour') ? DAY / 24 : m[2].startsWith('week') ? DAY * 7 : DAY;
    return { window: { from: now - n * unit, to: now, label: `last ${n} ${m[2]}` }, matched: m[0] };
  }
  if (/\btoday\b/.test(q)) return { window: { from: startOfDay(now), to: now, label: 'today' }, matched: 'today' };
  if (/\byesterday\b/.test(q)) {
    const start = startOfDay(now) - DAY;
    return { window: { from: start, to: start + DAY, label: 'yesterday' }, matched: 'yesterday' };
  }
  if (/\b(this|past|last)\s+week\b/.test(q)) {
    const lastWeek = /\blast week\b/.test(q);
    const d = new Date(now);
    const mondayOffset = (d.getDay() + 6) % 7;
    const monday = startOfDay(now) - mondayOffset * DAY;
    return lastWeek
      ? { window: { from: monday - 7 * DAY, to: monday, label: 'last week' }, matched: 'last week' }
      : { window: { from: monday, to: now, label: 'this week' }, matched: 'this week' };
  }
  if (/\b(this|past|last)\s+month\b/.test(q)) {
    return { window: { from: now - 30 * DAY, to: now, label: 'last 30 days' }, matched: 'month' };
  }
  if (/\b(recent|recently|latest|new)\b/.test(q)) {
    return { window: { from: now - 3 * DAY, to: now, label: 'last 72 hours' }, matched: 'recent' };
  }
  return {};
}

export function parseQuery(input: string, knownSites: string[], now: number = Date.now()): ParsedQuery {
  const raw = input.trim();
  let q = ` ${raw.toLowerCase().replace(/[“”"'’?!.,;:()]/g, ' ').replace(/\s+/g, ' ')} `;
  const understood: string[] = [];

  const severities = new Set<Severity>();
  for (const [re, values] of SEVERITY_WORDS) {
    const m = q.match(re);
    if (m) {
      values.forEach((v) => severities.add(v));
      understood.push(m[0].trim());
      q = q.replace(re, ' ');
    }
  }

  const sites: string[] = [];
  for (const site of [...knownSites].sort((a, b) => b.length - a.length)) {
    const variants = [site.toLowerCase(), site.toLowerCase().replace('building', 'bldg')];
    for (const v of variants) {
      if (q.includes(` ${v} `) || q.includes(` ${v}`)) {
        sites.push(site);
        understood.push(site);
        q = q.replace(v, ' ');
        break;
      }
    }
  }

  const categories = new Set<Category>();
  for (const [re, category] of CATEGORY_WORDS) {
    const m = q.match(re);
    if (m) {
      categories.add(category);
      understood.push(m[0].trim());
    }
  }

  const statuses = new Set<FindingStatus>();
  for (const [re, values] of STATUS_WORDS) {
    const m = q.match(re);
    if (m) {
      values.forEach((v) => statuses.add(v));
      understood.push(m[0].trim());
      q = q.replace(re, ' ');
    }
  }

  const mediaTypes = new Set<ResourceType>();
  for (const [re, type] of MEDIA_WORDS) {
    const m = q.match(re);
    if (m) {
      mediaTypes.add(type);
      understood.push(m[0].trim());
    }
  }

  const { window, matched } = detectWindow(q, now);
  if (matched) {
    understood.push(matched);
    q = q.replace(matched, ' ');
  }

  // Category words also stay available as keywords (e.g. "bridge" should rank bridge media first).
  const keywords = Array.from(
    new Set(
      q
        .split(' ')
        .map((t) => t.trim())
        .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t))
        .map(stem),
    ),
  );

  return {
    raw,
    severities: Array.from(severities),
    categories: Array.from(categories),
    sites: Array.from(new Set(sites)),
    mediaTypes: Array.from(mediaTypes),
    statuses: Array.from(statuses),
    window,
    keywords,
    understood,
  };
}

export interface SearchHit {
  asset: MediaAsset;
  score: number;
  matched: string[];
}

export interface SearchResult {
  hits: SearchHit[];
  /** Free-text keywords actually used for matching (category words become filters instead). */
  keywords: string[];
  /** Keywords that matched no record — surfaced honestly instead of silently dropped. */
  unmatchedKeywords: string[];
  /** True when keywords matched nothing and results rely on structured filters only. */
  relaxed: boolean;
}

/**
 * Keywords match descriptors only (tags, titles, file, location, category) —
 * not free-text observations, which contain negations such as "no damage visible".
 */
function haystack(asset: MediaAsset): string[] {
  const f = asset.finding;
  return [...asset.tags, asset.title, asset.fileName, asset.site, asset.zone ?? '', f?.title ?? '', f?.category ?? ''].map((s) =>
    s.toLowerCase(),
  );
}

function keywordHits(asset: MediaAsset, keyword: string): boolean {
  const variants = SYNONYMS[keyword] ?? [keyword];
  const hay = haystack(asset);
  return variants.some((v) => hay.some((h) => h.includes(v)));
}

export function runQuery(parsed: ParsedQuery, assets: MediaAsset[]): SearchResult {
  const filtered = assets.filter((asset) => {
    const f = asset.finding;
    if (parsed.severities.length && (!f || !parsed.severities.includes(f.severity))) return false;
    if (parsed.statuses.length && (!f || !parsed.statuses.includes(f.status))) return false;
    if (parsed.sites.length && !parsed.sites.includes(asset.site)) return false;
    if (parsed.mediaTypes.length === 1 && asset.resourceType !== parsed.mediaTypes[0]) return false;
    if (parsed.categories.length && (!f || !parsed.categories.includes(f.category))) return false;
    if (parsed.window) {
      const t = new Date(asset.capturedAt).getTime();
      if (t < parsed.window.from || t > parsed.window.to) return false;
    }
    return true;
  });

  // Keywords that are just category words have already been applied as filters.
  const categoryWords = new Set(parsed.understood.map((u) => stem(u)));
  const keywords = parsed.keywords.filter((k) => !categoryWords.has(k));

  const scored: SearchHit[] = filtered.map((asset) => {
    const matched = keywords.filter((k) => keywordHits(asset, k));
    const severityBoost = { critical: 0.4, high: 0.3, medium: 0.2, low: 0.1 }[asset.finding?.severity ?? 'low'];
    return { asset, matched, score: matched.length * 2 + severityBoost };
  });

  const unmatchedKeywords = keywords.filter((k) => !scored.some((h) => h.matched.includes(k)));
  const anyKeywordHit = scored.some((h) => h.matched.length > 0);
  const hasStructured =
    parsed.severities.length + parsed.categories.length + parsed.sites.length + parsed.statuses.length + parsed.mediaTypes.length > 0 ||
    Boolean(parsed.window);

  let hits = scored;
  let relaxed = false;
  if (keywords.length) {
    if (anyKeywordHit) {
      hits = scored.filter((h) => h.matched.length > 0);
    } else if (hasStructured) {
      relaxed = true; // keep structured results, report the unmatched keywords
    } else {
      hits = [];
    }
  }

  hits.sort((a, b) => b.score - a.score || +new Date(b.asset.capturedAt) - +new Date(a.asset.capturedAt));
  return { hits, keywords, unmatchedKeywords, relaxed };
}

export const EXAMPLE_QUERIES = [
  'Show all damaged equipment',
  'Find construction photos containing cracks',
  'Show high severity issues from Building B',
  'Find all inspection media from this week',
];
