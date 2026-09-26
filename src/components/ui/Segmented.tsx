'use client';

import { motion } from 'framer-motion';
import { useId, type ReactNode } from 'react';
import { cn } from './cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

/** Segmented control with a gliding selection indicator. */
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
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('inline-flex items-center rounded-[9px] border border-line bg-canvas p-0.5', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative inline-flex items-center gap-1.5 rounded-[7px] font-medium transition-colors',
              size === 'sm' ? 'h-6 px-2 text-[11.5px]' : 'h-7 px-2.5 text-[12.5px]',
              active ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
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
