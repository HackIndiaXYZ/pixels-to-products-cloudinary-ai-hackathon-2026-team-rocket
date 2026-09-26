'use client';

import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import { useEffect, useState, type MouseEvent } from 'react';
import { Logo } from '@/components/brand/Logo';
import { cn } from '@/components/ui/cn';

/**
 * Section links are root-relative ('/#platform') so they work from /privacy and
 * /terms too; on '/' Next's Link still performs an in-page hash scroll. Only the
 * Media Library leaves the page, so only it carries the outbound arrow.
 */
const LINKS: Array<{ label: string; href: string; section?: string }> = [
  { label: 'Platform', href: '/#platform', section: 'platform' },
  { label: 'Solutions', href: '/#solutions', section: 'solutions' },
  { label: 'Intelligence', href: '/#intelligence', section: 'intelligence' },
  { label: 'Media Library', href: '/console#library' },
  { label: 'Technology', href: '/#technology', section: 'technology' },
];

/**
 * Skip link target: the page's <main id="content">. Pages without that id still
 * get a working skip link — focus moves to their first <main>.
 */
function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
  const target = document.getElementById('content') ?? document.querySelector('main');
  if (!target) return;
  event.preventDefault();
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'start' });
}

/** Company navigation: quiet over the hero, solid once scrolled, with a scroll-spy indicator. */
export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const sections = LINKS.map((l) => l.section)
      .filter((s): s is string => Boolean(s))
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!sections.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: [0, 0.01] },
    );
    sections.forEach((s) => io.observe(s));
    const onTop = () => {
      if (window.scrollY < window.innerHeight * 0.5) setActive(null);
    };
    window.addEventListener('scroll', onTop, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onTop);
    };
  }, []);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-[background-color,border-color] duration-300',
        scrolled || open ? 'border-b border-line bg-canvas/90 backdrop-blur-md' : 'border-b border-transparent',
      )}
    >
      <a
        href="#content"
        onClick={skipToContent}
        className="btn btn-secondary btn-sm fixed left-3 top-3 z-[60] -translate-y-[200%] focus:translate-y-0"
      >
        Skip to content
      </a>
      <nav className="mx-auto flex h-[60px] max-w-[1440px] items-center gap-8 px-5 sm:px-8" aria-label="Main">
        <Link href="/" aria-label="VisualOps home" className="shrink-0">
          <Logo />
        </Link>
        <ul className="hidden items-center gap-1 lg:flex">
          {LINKS.map((link) => {
            const isActive = link.section !== undefined && active === link.section;
            const external = !link.section;
            return (
              <li key={link.label} className="relative">
                <Link
                  href={link.href}
                  aria-current={isActive ? 'location' : undefined}
                  className={cn(
                    'relative inline-flex h-9 items-center gap-1 px-3 text-[13px] transition-colors',
                    isActive ? 'text-ink' : 'text-ink-2 hover:text-ink',
                  )}
                >
                  {link.label}
                  {external && <ArrowUpRight aria-hidden className="h-3 w-3 opacity-60" />}
                  {isActive && (
                    <motion.span
                      layoutId="site-nav-active"
                      className="absolute inset-x-3 -bottom-[1px] h-px bg-signal"
                      transition={{ type: 'spring', stiffness: 420, damping: 38 }}
                    />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/console" className="btn btn-primary btn-sm hidden sm:inline-flex">
            Launch console
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-icon shrink-0 lg:hidden"
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.div
            id="site-menu"
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-line lg:hidden"
          >
            <ul className="space-y-1 px-5 py-4">
              {LINKS.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="type-heading flex items-center gap-2 py-2 text-[22px] text-ink"
                  >
                    {link.label}
                    {!link.section && <ArrowUpRight aria-hidden className="h-4 w-4 text-ink-3" />}
                  </Link>
                </li>
              ))}
              <li className="pt-3">
                <Link href="/console" className="btn btn-primary w-full" onClick={() => setOpen(false)}>
                  Launch console
                </Link>
              </li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
