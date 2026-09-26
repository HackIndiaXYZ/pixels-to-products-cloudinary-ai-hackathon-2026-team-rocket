const UNITS = ['B', 'KB', 'MB', 'GB'];

export function formatBytes(bytes: number | undefined, decimals = 1): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 ? 0 : decimals)} ${UNITS[i]}`;
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—';
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function formatMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso));
}

/** ISO date (YYYY-MM-DD) in local time, used in stamps and file names. */
export function isoDay(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

export function percentChange(from: number, to: number): number {
  if (!from) return 0;
  return ((to - from) / from) * 100;
}

export function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
