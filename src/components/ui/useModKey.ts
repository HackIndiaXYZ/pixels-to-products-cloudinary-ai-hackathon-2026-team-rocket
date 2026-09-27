'use client';

import { useClientValue } from '@/components/motion/hooks';

/** The label of the platform's shortcut modifier: ⌘ on Apple platforms, Ctrl elsewhere. */
export type ModKey = '⌘' | 'Ctrl';

const APPLE = /mac|iphone|ipad|ipod/i;

function readModKey(): ModKey {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
  return APPLE.test(platform) ? '⌘' : 'Ctrl';
}

const noopSubscribe = () => () => undefined;

/**
 * Shortcut modifier label for keyboard hints (`<Kbd>{mod}</Kbd><Kbd>K</Kbd>`, `${mod}↵`).
 *
 * Hydration-safe: the server and the hydration pass render '⌘'; the browser's
 * real platform applies right after, as a transition (no forced synchronous
 * re-render). Client-only mounts, such as the console, get the right label on
 * their first render. Handlers should keep accepting both metaKey and ctrlKey.
 */
export function useModKey(): ModKey {
  return useClientValue<ModKey>('⌘', readModKey, noopSubscribe);
}
