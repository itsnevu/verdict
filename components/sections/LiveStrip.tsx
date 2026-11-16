'use client';
import { useEffect, useState } from 'react';
import Marquee from './Marquee';

type Row = { symbol: string | null; address: string; score: number | null; label: string | null };

/** Marquee of the latest real verdicts; falls back to the static band when the API is offline. */
export default function LiveStrip({ fallback }: { fallback: string[] }) {
  const [items, setItems] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/verdict/tokens')
      .then((r) => r.json() as Promise<{ data: Row[] }>)
      .then((b) => {
        if (!alive || !b.data?.length) return;
        setItems(b.data.filter((t) => t.score !== null).map((t) => `${(t.symbol ?? t.address.slice(0, 6)).toUpperCase()} ${t.score} ${t.label}`));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return <Marquee key={items ? 'live' : 'static'} items={items ?? fallback} label={items ? 'Latest verdicts from Robinhood Chain' : 'VERDICT'} />;
}
