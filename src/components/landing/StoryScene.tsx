'use client';

import { useDeviceTier } from '@/components/motion/hooks';
import { StoryPinned } from './story/StoryPinned';
import { StoryStatic } from './story/StoryStatic';
import { useReducedPref } from './story/hooks';

/**
 * Platform story (id="platform"): RAW MEDIA → UNDERSTAND → STRUCTURE → SEARCH →
 * INSIGHT → ACTION as one continuous pinned scene. Low-tier devices get fewer
 * tiles and no kinetic font axes; reduced motion gets a static, stacked narrative.
 */
export function StoryScene() {
  const reduced = useReducedPref();
  const tier = useDeviceTier();
  if (reduced) return <StoryStatic />;
  return <StoryPinned tier={tier} />;
}
