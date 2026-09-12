import type { Fix } from '../../core/src/types.ts';
import type { Truth } from './metrics.ts';
import type { VenueMap } from '../../core/src/graph.ts';

/** Rysuje porównanie: ground truth vs czyste PDR vs filtr cząsteczkowy. Bez zależności. */
export function renderSVG(
  truth: Truth[],
  raw: { x: number; y: number }[],
  fixes: Fix[],
  venue: VenueMap | null,
  title: string,
): string {
  const pts = [...truth, ...raw, ...fixes];
  if (!pts.length) return '<svg xmlns="http://www.w3.org/2000/svg"/>';
  const pad = 6;
  const minX = Math.min(...pts.map(p => p.x)) - pad;
  const maxX = Math.max(...pts.map(p => p.x)) + pad;
  const minY = Math.min(...pts.map(p => p.y)) - pad;
  const maxY = Math.max(...pts.map(p => p.y)) + pad;
  const W = 900, H = Math.max(360, Math.round((W * (maxY - minY)) / (maxX - minX)));
  const sx = (x: number) => ((x - minX) / (maxX - minX)) * W;
  const sy = (y: number) => H - ((y - minY) / (maxY - minY)) * H;
  const path = (p: { x: number; y: number }[]) =>
    p.map((q, i) => `${i ? 'L' : 'M'}${sx(q.x).toFixed(1)},${sy(q.y).toFixed(1)}`).join(' ');

  const walls = venue
    ? venue.walls.map(w => `<line x1="${sx(w.ax)}" y1="${sy(w.ay)}" x2="${sx(w.bx)}" y2="${sy(w.by)}" stroke="#555" stroke-width="2"/>`).join('')
    : '';

  const ellipses = fixes
    .filter((_, i) => i % 8 === 0)
    .map(f => {
      const r = (f.r68 / (maxX - minX)) * W;
      return `<circle cx="${sx(f.x)}" cy="${sy(f.y)}" r="${r.toFixed(1)}" fill="#22d3ee" fill-opacity="0.07" stroke="#22d3ee" stroke-opacity="0.25"/>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 46}" viewBox="0 0 ${W} ${H + 46}" font-family="ui-monospace,monospace">
<rect width="100%" height="100%" fill="#0b0f14"/>
<g transform="translate(0,40)">
${walls}
${ellipses}
<path d="${path(truth)}" fill="none" stroke="#22c55e" stroke-width="3" stroke-opacity="0.9"/>
<path d="${path(raw)}" fill="none" stroke="#f97316" stroke-width="2" stroke-dasharray="5 4"/>
<path d="${path(fixes)}" fill="none" stroke="#22d3ee" stroke-width="2.5"/>
<circle cx="${sx(truth[0].x)}" cy="${sy(truth[0].y)}" r="5" fill="#fff"/>
</g>
<text x="12" y="20" fill="#e5e7eb" font-size="14">${esc(title)}</text>
<text x="12" y="34" font-size="11">
  <tspan fill="#22c55e">— ground truth</tspan>
  <tspan fill="#f97316" dx="14">-- czyste PDR</tspan>
  <tspan fill="#22d3ee" dx="14">— filtr cząsteczkowy (+elipsy 1σ)</tspan>
</text>
</svg>`;
}
const esc = (s: string): string => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));
