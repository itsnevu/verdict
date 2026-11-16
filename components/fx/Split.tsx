import { Fragment, type CSSProperties, type ElementType } from 'react';

type Props = {
  text: string;
  as?: ElementType;
  className?: string;
  /** word (without punctuation) to italicise with the vermilion underline */
  em?: string;
  /** "io" = revealed by IntersectionObserver, "gsap" = driven by a timeline */
  mode?: 'io' | 'gsap';
  id?: string;
};

/** Wraps every character in a span. Parent keeps the full text for screen readers. */
export default function Split({ text, as: Tag = 'span', className, em, mode = 'io', id }: Props) {
  let i = 0;
  const words = text.split(' ');
  return (
    <Tag id={id} className={`split ${className ?? ''}`} aria-label={text} data-split={mode} data-s="off">
      {words.map((w, wi) => {
        const chars = Array.from(w).map((c) => (
          <span key={i} className="ch" aria-hidden style={{ '--i': i++ } as CSSProperties}>{c}</span>
        ));
        const isEm = em && w.replace(/[^\p{L}]/gu, '') === em;
        return (
          <Fragment key={wi}>
            <span className="w" aria-hidden>
              {isEm ? <em className="em-u">{chars}<span className="u" /></em> : chars}
            </span>
            {wi < words.length - 1 ? ' ' : null}
          </Fragment>
        );
      })}
    </Tag>
  );
}
