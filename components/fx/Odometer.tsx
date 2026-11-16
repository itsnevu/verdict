'use client';
import type { CSSProperties } from 'react';

/** Rolling digits. Each digit is a 0–9 strip translated to its value. */
export default function Odometer({ value, pad = 0, group = true, className = '' }: { value: number; pad?: number; group?: boolean; className?: string }) {
  const raw = Math.max(0, Math.floor(value)).toString().padStart(pad, '0');
  const str = group ? Number(raw).toLocaleString('en-US').padStart(pad, '0') : raw;
  return (
    <span className={`odo ${className}`} aria-label={str} role="img">
      {Array.from(str).map((c, i) =>
        /\d/.test(c) ? (
          <span key={str.length - i} className="odo-d" aria-hidden>
            <span className="odo-strip" style={{ '--d': Number(c) } as CSSProperties}>
              {'0123456789'.split('').map((n) => <span key={n}>{n}</span>)}
            </span>
          </span>
        ) : (
          <span key={`s${str.length - i}`} className="odo-s" aria-hidden>{c}</span>
        ),
      )}
    </span>
  );
}
