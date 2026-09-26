import { Activity, type ReactNode } from 'react';
import { SiteNav } from '@/components/site/SiteNav';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Hero } from '@/components/landing/Hero';
import { Statement } from '@/components/landing/Statement';
import { StoryScene } from '@/components/landing/StoryScene';
import { Solutions } from '@/components/landing/Solutions';
import { ProductReveal } from '@/components/landing/ProductReveal';
import { Evidence } from '@/components/landing/Evidence';
import { Technology } from '@/components/landing/Technology';
import { FinalCta } from '@/components/landing/FinalCta';

/**
 * A selective-hydration boundary for one below-the-fold section.
 *
 * React 19.2 hydrates a visible <Activity> as its own dehydrated unit at
 * offscreen priority — its own render, commit and effects, and first whichever
 * section the visitor interacts with — so the page never hydrates in one long
 * task. Unlike <Suspense>, Fizz never outlines an Activity boundary: the server
 * HTML stays in document order (no hidden `S:n` segments revealed by script), so
 * /#platform links, reload scroll restoration and no-JS rendering are unchanged.
 */
function Deferred({ name, children }: { name: string; children: ReactNode }) {
  return (
    <Activity mode="visible" name={name}>
      {children}
    </Activity>
  );
}

/**
 * Landing rhythm (dark ↔ light):
 * Hero · Statement · Story (pinned) · Solutions · Product reveal · Evidence · Technology · Final CTA
 *
 * `data-page="landing"` scopes smooth in-page scrolling to this page (globals.css);
 * `id="content"` is the skip link's target.
 */
export default function Home() {
  return (
    <>
      <SiteNav />
      <main id="content" tabIndex={-1} data-page="landing" className="outline-none">
        <Hero />
        <Deferred name="statement">
          <Statement />
        </Deferred>
        <Deferred name="story">
          <StoryScene />
        </Deferred>
        <Deferred name="solutions">
          <Solutions />
        </Deferred>
        <Deferred name="product-reveal">
          <ProductReveal />
        </Deferred>
        <Deferred name="evidence">
          <Evidence />
        </Deferred>
        <Deferred name="technology">
          <Technology />
        </Deferred>
        <Deferred name="final-cta">
          <FinalCta />
        </Deferred>
      </main>
      <Deferred name="footer">
        <SiteFooter />
      </Deferred>
    </>
  );
}
