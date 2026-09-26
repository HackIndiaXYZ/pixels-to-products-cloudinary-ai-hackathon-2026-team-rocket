import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteNav } from '@/components/site/SiteNav';
import { SiteFooter } from '@/components/site/SiteFooter';

export const metadata: Metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  return (
    <>
      <SiteNav />
      <main id="content" tabIndex={-1} className="theme-light min-h-screen px-5 pb-24 pt-36 outline-none sm:px-8">
        <article className="mx-auto max-w-2xl">
          <p className="label">Privacy</p>
          <h1 className="type-display mt-4 text-[44px]">What VisualOps does with your media.</h1>
          <div className="mt-8 space-y-5 text-[16px] leading-relaxed text-ink-2">
            <p>VisualOps runs in your browser. It has no backend, no accounts and no analytics.</p>
            <p>
              Media you upload goes directly from your browser to <em>your own</em> Cloudinary cloud through the unsigned upload preset you
              configure. VisualOps never receives it and never uses a Cloudinary API secret.
            </p>
            <p>
              Uploaded and synced records, and any Cloudinary settings you enter, are stored in this browser’s local storage so the console
              remembers them. Clearing site data removes them; the media stays in your Cloudinary account.
            </p>
            <p>
              The sample dataset is served from Cloudinary’s public demo cloud. Faces in media can be pixelated by Cloudinary
              (<code className="font-mono text-[14px]">e_pixelate_faces</code>) before anything is shared, and in report evidence, faces
              Cloudinary detects are pixelated by default. Detection is automatic and can miss people (or number plates, which it does
              not look for), so check a frame before you share it outside your team.
            </p>
          </div>
          <Link href="/" className="btn btn-secondary mt-10">Back to VisualOps</Link>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
