'use client';

import { motion } from 'framer-motion';
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from './cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

/**
 * Segmented control with a gliding selection indicator.
 *
 * Keyboard: a proper radio group — one tab stop (the checked option, roving
 * tabindex); ←/→ and ↑/↓ move the selection with wrap-around, Home/End jump to
 * the ends, and focus follows the selection. Handled keys are preventDefault-ed,
 * so surrounding shortcuts (e.g. the Inspector's ←/→ record stepping) skip them.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: 'sm' | 'md';
  className?: string;
  ariaLabel?: string;
}) {
  const id = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  // If the value is not one of the options, the first option still takes the tab stop.
  const tabStop = selectedIndex >= 0 ? selectedIndex : 0;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const count = options.length;
    if (!count) return;
    const focused = buttons.current.findIndex((b) => b === document.activeElement);
    const from = focused >= 0 ? focused : tabStop;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (from + 1) % count;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (from - 1 + count) % count;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    buttons.current[next]?.focus();
    if (options[next].value !== value) onChange(options[next].value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn('inline-flex items-center rounded-[9px] border border-line bg-canvas p-0.5', className)}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={index === tabStop ? 0 : -1}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative inline-flex items-center gap-1.5 rounded-[7px] font-medium transition-colors',
              // Touch: the console's 32–36px target on coarse pointers.
              size === 'sm' ? 'h-6 px-2 text-[11.5px] pointer-coarse:h-8 pointer-coarse:px-2.5' : 'h-7 px-2.5 text-[12.5px] pointer-coarse:h-9',
              active ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                layoutDependency={value}
                className="absolute inset-0 rounded-[7px] border border-line-strong bg-raised"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-1.5">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
