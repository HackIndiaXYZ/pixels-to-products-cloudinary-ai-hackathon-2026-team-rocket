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
            <p>
              VisualOps runs in your browser with a small server component. It has no accounts, no database and no analytics.
            </p>
            <p>
              Media you upload goes directly from your browser to the team’s own Cloudinary cloud. When the server is connected, it signs each
              upload with the Cloudinary API secret held in its environment — the file itself never passes through VisualOps’ server and the
              secret never reaches the browser. Without a server, uploads use an unsigned upload preset you configure.
            </p>
            <p>
              The record fields you enter (title, site, category, severity, observation) are stored with the media in Cloudinary as tags and
              contextual metadata, and the server reads them back with Cloudinary’s Search API. This browser’s local storage keeps a copy of
              records added here and any settings you enter; clearing site data removes that copy, not the media in Cloudinary.
            </p>
            <p>
              When you upload a photo, VisualOps runs Cloudinary AI Content Analysis on it: a caption, the objects Cloudinary detects (with
              confidence and position) and automatic tags. VisualOps’ server asks Cloudinary to analyse the image already stored in the
              team’s cloud — the file is not re-uploaded or passed through VisualOps — and only for images that carry the VisualOps tag;
              videos are not analysed. The results are stored as contextual metadata and tags on that asset in the team’s Cloudinary cloud,
              next to the record fields, and VisualOps always labels them <em>AI detected</em>, separate from what a person entered. Each
              analysis counts against the team’s Cloudinary add-on quota. Removing a record from the workspace only removes the VisualOps
              tag; the media and its metadata stay in Cloudinary until the team deletes them there.
            </p>
            <p>
              VisualOps’ pages are served with a strict set of security headers: a Content Security Policy that only allows this site and
              Cloudinary, no framing by other sites, no camera, microphone or location access, and no sniffing of content types.
            </p>
            <p>
              The bundled sample dataset is served from Cloudinary’s public demo cloud, and a sample workspace seeded into the team’s own
              cloud carries the same team-written annotations, labelled as sample annotations. Faces in media can be pixelated by Cloudinary
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
