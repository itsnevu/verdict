'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type Lenis from 'lenis';
import type { ScrollTrigger } from 'gsap/ScrollTrigger';
import { brand } from './content';

/* shared mutable refs (no re-render needed) */
export const lenisRef: { current: Lenis | null } = { current: null };
export const heroState: { p: number; st: ScrollTrigger | null } = { p: 0, st: null };

/* live block height — Robinhood Chain style ~2 s blocks, simulated client-side */
let block = brand.startBlock;
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function subscribe(cb: () => void) {
  subs.add(cb);
  if (!timer) timer = setInterval(() => { block += 1; subs.forEach((f) => f()); }, 2000);
  return () => { subs.delete(cb); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
}
export function useBlock() {
  return useSyncExternalStore(subscribe, () => block, () => brand.startBlock);
}

/* deterministic pseudo hash for feeds */
export function fakeHash(seed: number, len = 64) {
  let x = seed * 2654435761 >>> 0;
  let s = '';
  while (s.length < len) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; s += x.toString(16).padStart(8, '0'); }
  return s.slice(0, len);
}

export function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    setR(m.matches);
    const f = () => setR(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return r;
}

export function store<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
export function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked */ }
}

export function scrollToY(y: number) {
  if (lenisRef.current) lenisRef.current.scrollTo(y, { duration: 1.4 });
  else window.scrollTo({ top: y, behavior: 'smooth' });
}
export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  if (lenisRef.current) lenisRef.current.scrollTo(el, { offset: -64, duration: 1.4 });
  else el.scrollIntoView({ behavior: 'smooth' });
}

/* arrow-key roving helper for radiogroups / tablists / listboxes */
export function rove(e: React.KeyboardEvent, i: number, n: number, set: (i: number) => void) {
  const k = e.key;
  let j = -1;
  if (k === 'ArrowRight' || k === 'ArrowDown') j = (i + 1) % n;
  else if (k === 'ArrowLeft' || k === 'ArrowUp') j = (i - 1 + n) % n;
  else if (k === 'Home') j = 0;
  else if (k === 'End') j = n - 1;
  if (j < 0) return;
  e.preventDefault();
  set(j);
  const parent = (e.currentTarget as HTMLElement).parentElement;
  (parent?.children[j] as HTMLElement | undefined)?.focus();
}

/** non-React access to the live block height */
export function onBlock(cb: (b: number) => void) {
  return subscribe(() => cb(block));
}
export const currentBlock = () => block;
