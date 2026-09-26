'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { useConsoleActions, useConsoleUi } from './store';
import { AskBody } from './ask/AskBody';

const EASE = [0.16, 1, 0.3, 1] as const;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** ⌘K / Ctrl+K: the shell's toggle, which must still reach it so it can close Ask. */
function isToggle(event: { metaKey: boolean; ctrlKey: boolean; key: string }): boolean {
  return (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
}

/**
 * Keys pressed inside Ask stay inside Ask. It runs after Ask's own React handlers
 * (React listens on the document root, registered before any overlay's listener),
 * so layers underneath that listen on document or window — an open Inspector's
 * ←/→ stepping and focus trap — never act on them. Only the shell's ⌘K toggle passes.
 */
function containKeys(event: ReactKeyboardEvent) {
  if (isToggle(event)) return;
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation();
}

/**
 * Modal behaviour for the command system: body scroll lock, focus on open,
 * a complete focus trap, Escape to close (captured, so an open Inspector
 * underneath is not closed with it) and focus restored to wherever it was before.
 */
function useOverlay(open: boolean, onClose: () => void, panelRef: RefObject<HTMLDivElement | null>) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      const target = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel;
      target?.focus({ preventScroll: true });
    });

    // Capture phase on window: runs before anything else sees the key.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      const panel = panelRef.current;
      if (!panel) return;
      if (event.key === 'Tab') {
        // Focus moves only between Ask's own controls, and Tab never reaches a trap
        // underneath (an open Inspector would otherwise pull focus behind the modal).
        event.preventDefault();
        event.stopPropagation();
        const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.tabIndex >= 0 && el.getClientRects().length > 0,
        );
        if (!focusables.length) {
          panel.focus({ preventScroll: true });
          return;
        }
        const index = focusables.indexOf(document.activeElement as HTMLElement);
        const step = event.shiftKey ? -1 : 1;
        const next =
          index < 0 ? focusables[event.shiftKey ? focusables.length - 1 : 0] : focusables[(index + step + focusables.length) % focusables.length];
        next.focus();
        return;
      }
      // Focus fell out of the panel (its control was removed): keep the key in Ask and
      // hand focus back to the question, so typing continues there.
      const target = event.target instanceof Node ? event.target : null;
      if (!target || !panel.contains(target)) {
        if (isToggle(event)) return;
        event.stopPropagation();
        (panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel).focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', onKey, true);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [open, panelRef]);
}

/**
 * Ask VisualOps — the command system and evidence browser.
 * Toggled by ConsoleShell (⌘K / Ctrl+K and "/") through `paletteOpen`.
 */
export function AskPalette() {
  const { paletteOpen } = useConsoleUi();
  const { setPaletteOpen } = useConsoleActions();
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Only ever set, never cleared: a panel still exiting must not null the ref of the one entering.
  const setPanel = useCallback((el: HTMLDivElement | null) => {
    if (el) panelRef.current = el;
  }, []);
  const close = useCallback(() => setPaletteOpen(false), [setPaletteOpen]);
  useOverlay(paletteOpen, close, panelRef);

  // Each opening is a fresh session (new key), so reopening while the previous
  // panel is still animating out never revives its state.
  const [session, setSession] = useState({ open: paletteOpen, id: 0 });
  if (session.open !== paletteOpen) setSession({ open: paletteOpen, id: paletteOpen ? session.id + 1 : session.id });

  return (
    <AnimatePresence>
      {paletteOpen && (
        <div key={session.id} className="fixed inset-0 z-50 flex items-start justify-center p-2 sm:px-6 sm:pb-6 sm:pt-[6vh]">
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-canvas/85"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.16, ease: EASE } }}
            transition={{ duration: 0.26, ease: EASE }}
            onClick={close}
          />
          <motion.div
            ref={setPanel}
            role="dialog"
            aria-modal="true"
            aria-label="Ask VisualOps"
            tabIndex={-1}
            onKeyDown={containKeys}
            initial={{ opacity: 0, scale: 0.98, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.99, y: -6, transition: { duration: 0.16, ease: EASE } }}
            transition={{ duration: 0.26, ease: EASE }}
            className="relative z-10 flex h-[calc(100dvh-16px)] w-full max-w-[1080px] origin-top flex-col overflow-hidden rounded-[10px] border border-line-strong bg-surface shadow-[0_28px_70px_-28px_rgba(0,0,0,0.75)] outline-none sm:h-[min(86vh,880px)]"
          >
            <AskBody onClose={close} />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
