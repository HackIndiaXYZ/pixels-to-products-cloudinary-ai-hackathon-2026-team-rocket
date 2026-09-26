import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteNav } from '@/components/site/SiteNav';
import { SiteFooter } from '@/components/site/SiteFooter';

export const metadata: Metadata = { title: 'Terms' };

export default function TermsPage() {
  return (
    <>
      <SiteNav />
      <main id="content" tabIndex={-1} className="theme-light min-h-screen px-5 pb-24 pt-36 outline-none sm:px-8">
        <article className="mx-auto max-w-2xl">
          <p className="label">Terms</p>
          <h1 className="type-display mt-4 text-[44px]">A hackathon product, openly licensed.</h1>
          <div className="mt-8 space-y-5 text-[16px] leading-relaxed text-ink-2">
            <p>
              VisualOps was built by Team Rocket for Pixels to Products — the Cloudinary AI Hackathon 2026. The source code is released under
              the MIT License.
            </p>
            <p>
              Findings in the sample dataset are annotations written by the team to demonstrate the product; they are not real inspection
              results. Generative outputs are labelled and are never evidence.
            </p>
            <p>Use of Cloudinary is subject to Cloudinary’s own terms. Sample media is hosted on Cloudinary’s public demo cloud.</p>
          </div>
          <Link href="/" className="btn btn-secondary mt-10">Back to VisualOps</Link>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
