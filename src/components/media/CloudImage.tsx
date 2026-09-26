'use client';

import type { ImgHTMLAttributes, SyntheticEvent } from 'react';
import { cn } from '@/components/ui/cn';

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string;
  alt: string;
};

/**
 * A plain <img> for Cloudinary delivery URLs. Cloudinary already resizes and
 * negotiates the format (q_auto, f_auto), so next/image's optimiser would only
 * add a second, redundant proxy hop. Visibility never depends on a transition,
 * so images also show in background tabs and when printing.
 */
export function CloudImage({ className, onLoad, loading = 'lazy', alt, ...rest }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Cloudinary performs the optimisation.
    <img
      {...rest}
      alt={alt}
      loading={loading}
      decoding="async"
      onLoad={(event: SyntheticEvent<HTMLImageElement>) => onLoad?.(event)}
      className={cn('select-none', className)}
    />
  );
}
