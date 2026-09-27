import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SiteNav } from '@/components/site/SiteNav';
import { SiteFooter } from '@/components/site/SiteFooter';

/** Any URL the app doesn't handle: the site's own frame, with the two ways back in. */
export default function NotFound() {
  return (
    <>
      <SiteNav />
      <main id="content" tabIndex={-1} className="theme-light min-h-screen px-5 pb-24 pt-36 outline-none sm:px-8">
        <article className="mx-auto max-w-2xl">
          <p className="label">404 · Not found</p>
          <h1 className="type-display mt-4 text-[44px]">This page isn’t part of VisualOps.</h1>
          <p className="mt-8 text-[16px] leading-relaxed text-ink-2">
            The link may be old or mistyped. The product story and the console are both one click away.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link href="/" className="btn btn-secondary btn-lg">
              Back to VisualOps
            </Link>
            <Link href="/console" data-cursor="OPEN" className="btn btn-primary btn-lg">
              Open the console <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
