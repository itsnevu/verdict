import { useId } from 'react';

/**
 * VERDICT mark: a V whose left stroke runs from cream into vermilion while the vermilion right
 * stroke folds out of it. Proportions are taken from the reference artwork (V at x 504–944,
 * y 368–714 on a 1448-wide canvas) and scaled into a 100×100 ink tile, so the cream stroke
 * stays visible on light pages.
 */
export const MARK_PATHS = {
  right: 'M65.7 21.7 H86 L57.8 78.3 L50 59.5 Z',
  fold: 'M50 59.5 L60.5 41 L57.4 63.5 Z',
  left: 'M14 21.7 H31.7 L57.8 78.3 H41.8 Z',
};

export default function BrandMark({ size = 24, tile = true, className }: { size?: number; tile?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className={className}>
      <defs>
        <linearGradient id={`l${id}`} x1="0" y1="0" x2="0.55" y2="1">
          <stop offset="0" stopColor="#F4EFE8" />
          <stop offset="0.6" stopColor="#F1E4DA" />
          <stop offset="1" stopColor="#FF3B12" />
        </linearGradient>
        <linearGradient id={`r${id}`} x1="1" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#FF4A1F" />
          <stop offset="1" stopColor="#FF3B12" />
        </linearGradient>
        <linearGradient id={`f${id}`} x1="0.2" y1="0.8" x2="1" y2="0">
          <stop offset="0" stopColor="#4A0E03" stopOpacity="0.85" />
          <stop offset="1" stopColor="#FF3B12" stopOpacity="0" />
        </linearGradient>
      </defs>
      {tile && <rect width="100" height="100" rx="18" fill="#0E0C0A" />}
      <path d={MARK_PATHS.right} fill={`url(#r${id})`} strokeLinejoin="round" />
      <path d={MARK_PATHS.fold} fill={`url(#f${id})`} />
      <path d={MARK_PATHS.left} fill={`url(#l${id})`} strokeLinejoin="round" />
    </svg>
  );
}
