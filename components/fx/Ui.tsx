'use client';
import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy as CopyIcon } from 'lucide-react';
import { rove } from '@/lib/runtime';

export function CopyBtn({ text, label = 'copy' }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      aria-label={ok ? 'copied' : `${label}: ${text}`}
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ }
        setOk(true); setTimeout(() => setOk(false), 1400);
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={ok ? 'y' : 'n'} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} transition={{ duration: 0.16 }} className="inline-flex items-center gap-1">
          {ok ? <Check size={13} aria-hidden /> : <CopyIcon size={13} aria-hidden />}
          <span>{ok ? 'copied' : label}</span>
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

export function CmdBlock({ cmd, prefix = '$', copyText, disabled }: { cmd: string; prefix?: string; copyText?: string; disabled?: string }) {
  return (
    <div className={`cmd ${disabled ? 'cmd-off' : ''}`}>
      <code><span className="cmd-p" aria-hidden>{prefix}</span> {cmd}</code>
      {disabled ? <span className="cmd-soon mono">{disabled}</span> : <CopyBtn text={copyText ?? cmd} />}
    </div>
  );
}

/** Radiogroup-style segmented control with arrow keys. */
export function Segmented<T extends string>({ options, value, onChange, label, render }: { options: readonly T[]; value: T; onChange: (v: T) => void; label: string; render?: (v: T) => ReactNode }) {
  const i = options.indexOf(value);
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o, j) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          tabIndex={o === value ? 0 : -1}
          className="seg-b"
          onClick={() => onChange(o)}
          onKeyDown={(e) => rove(e, i, options.length, (k) => onChange(options[k]))}
        >
          {render ? render(o) : o}
        </button>
      ))}
    </div>
  );
}

/** Tablist; panel rendering is left to the caller. */
export function Tabs<T extends string>({ options, value, onChange, label, idBase }: { options: readonly T[]; value: T; onChange: (v: T) => void; label: string; idBase: string }) {
  const i = options.indexOf(value);
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((o, j) => (
        <button
          key={o}
          id={`${idBase}-tab-${j}`}
          type="button"
          role="tab"
          aria-selected={o === value}
          aria-controls={`${idBase}-panel`}
          tabIndex={o === value ? 0 : -1}
          className="tab-b"
          onClick={() => onChange(o)}
          onKeyDown={(e) => rove(e, i, options.length, (k) => onChange(options[k]))}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function Kicker({ n, children }: { n: string; children: ReactNode }) {
  return <p className="kicker"><span className="kicker-n">{n}</span> {children}</p>;
}

export function SectionNum({ n }: { n: string }) {
  return <span className="sec-num" aria-hidden>{n}</span>;
}
