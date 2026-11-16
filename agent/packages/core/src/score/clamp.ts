export type Point = readonly [number, number];

/**
 * Piecewise-linear map. Interpolates between consecutive points, clamps outside the ends.
 * Points must be sorted by x ascending; repeated x values are allowed (step).
 */
export function piecewise(points: readonly Point[], x: number): number {
  if (points.length === 0) throw new Error('piecewise: no points');
  if (Number.isNaN(x)) throw new Error('piecewise: NaN input');
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    if (x <= x1) {
      const [x0, y0] = points[i - 1]!;
      if (x1 === x0) return y1;
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return last[1];
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round = (v: number, dp = 0) => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};
