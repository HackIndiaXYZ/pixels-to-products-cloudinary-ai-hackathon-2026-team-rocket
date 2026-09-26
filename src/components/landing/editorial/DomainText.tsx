'use client';

import { motion } from 'framer-motion';
import { SEVERITY_COLOR } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { EASE_EDITORIAL } from './hooks';
import { domainFacts, DOMAINS, type Domain } from './domains';

/** Running header that opens each domain: index, categories, capture count. */
export function DomainRule({ domain, className }: { domain: Domain; className?: string }) {
  const facts = domainFacts(domain);
  const index = DOMAINS.indexOf(domain) + 1;
  return (
    <div className={cn('relative flex items-baseline gap-4 pt-4', className)}>
      <motion.span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px origin-left bg-line-strong"
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true, margin: '0px 0px -8% 0px' }}
        transition={{ duration: 1.1, ease: EASE_EDITORIAL }}
      />
      <span className="label num text-ink">
        {String(index).padStart(2, '0')} / {String(DOMAINS.length).padStart(2, '0')}
      </span>
      <span className="label hidden sm:inline">{facts.categories.join(' · ')}</span>
      <span className="label num ml-auto">{facts.count} captures</span>
    </div>
  );
}

/**
 * Domain title, one precise sentence and a small fact list computed from the
 * dataset records (finding IDs by severity, sites, media mix).
 */
export function DomainText({
  domain,
  className,
  titleId,
  compact = false,
}: {
  domain: Domain;
  className?: string;
  titleId: string;
  compact?: boolean;
}) {
  const facts = domainFacts(domain);
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      transition={{ duration: 0.7, ease: EASE_EDITORIAL }}
    >
      <h3
        id={titleId}
        className={cn(
          'type-heading text-balance text-ink',
          compact ? 'text-[28px] sm:text-[32px] lg:text-[34px]' : 'text-[30px] sm:text-[38px] lg:text-[44px]',
        )}
      >
        {domain.title}
      </h3>
      <p className="mt-3 max-w-[38ch] text-pretty text-[15.5px] leading-[1.55] text-ink-2 sm:mt-4 sm:text-[16.5px] sm:leading-[1.6]">
        {domain.sentence}
      </p>
      <dl className="mt-5 grid max-w-[26rem] grid-cols-[4.75rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-line pt-3 text-[13px] leading-snug sm:mt-7 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-y-2.5 sm:pt-4">
        <dt className="label pt-[3px]">Findings</dt>
        <dd className="flex flex-wrap gap-x-3.5 gap-y-1 font-mono text-[11.5px] text-ink">
          {facts.findings.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1.5" title={`Severity: ${f.severity}`}>
              <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: SEVERITY_COLOR[f.severity] }} />
              {f.id}
              <span className="sr-only"> ({f.severity})</span>
            </span>
          ))}
        </dd>
        <dt className="label pt-[3px]">{facts.sites.length === 1 ? 'Site' : 'Sites'}</dt>
        <dd className="text-ink-2">{facts.sites.join(' · ')}</dd>
        <dt className="label pt-[3px]">Media</dt>
        <dd className="text-ink-2">{facts.media}</dd>
      </dl>
    </motion.div>
  );
}
