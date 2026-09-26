import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/components/ui/cn';

/**
 * A box locked to the media's aspect ratio that fits inside `maxHeight`.
 * Because the media fills it exactly, percentage overlays (annotations,
 * Cloudinary AI regions) land on the right pixels at any size.
 */
export function MediaFrame({
  width,
  height,
  maxHeight = '70vh',
  className,
  children,
  style,
}: {
  width: number;
  height: number;
  maxHeight?: string;
  className?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const ratio = width / height;
  return (
    <div
      className={cn('relative mx-auto overflow-hidden', className)}
      style={{ aspectRatio: `${width} / ${height}`, width: `min(100%, calc(${maxHeight} * ${ratio}))`, ...style }}
    >
      {children}
    </div>
  );
}
