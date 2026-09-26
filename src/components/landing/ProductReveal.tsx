'use client';

import { useDeviceTier, useReducedMotionPref } from '@/components/motion/hooks';
import { FitReveal } from './product/FitReveal';
import { PinnedReveal } from './product/PinnedReveal';
import { useWideViewport } from './product/hooks';
import { MOCK } from './product/mock-data';

/**
 * Product reveal → console morph.
 *
 * A faithful miniature of the console's Command Center, computed from the same
 * sample dataset with the same helper. On desktop it rises out of a frame and
 * fills the viewport as you scroll ("entering the product"); its content column,
 * top bar and sidebar are React <ViewTransition>s paired with the console's
 * <main>, header and sidebar, so "Launch console" morphs the preview into the
 * real thing.
 *
 * Phones, small windows and reduced motion get the same miniature scaled to
 * fit, with no pinning. The server renders that version; wide screens switch to
 * the pinned stage after hydration as a transition (never a blocking render),
 * and the pinned stage mounts its heavy frame only when the section comes near.
 */
export function ProductReveal() {
  const wide = useWideViewport();
  const reduce = useReducedMotionPref();
  const tier = useDeviceTier();
  const pinned = wide && !reduce;

  return (
    <section id="intelligence" className="relative border-t border-line bg-canvas">
      {pinned ? <PinnedReveal tier={tier} /> : <FitReveal wide={wide} />}
      <p className="sr-only">
        The preview shows the VisualOps console Command Center, built from the sample dataset: {MOCK.headline}{' '}
        {MOCK.summary}. Highest risk: {MOCK.riskiest?.site ?? 'none'}. Findings are sample annotations.
      </p>
    </section>
  );
}
