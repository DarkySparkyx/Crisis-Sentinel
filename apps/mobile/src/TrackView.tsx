import React from 'react';
import Svg, { Circle, Ellipse, Line, Path, G, Text as SvgText } from 'react-native-svg';
import type { Fix } from '@core/types.ts';
import type { VenueMap } from '@core/graph.ts';

/**
 * Mapa "taktyczna": ślad, elipsa niepewności, ściany, punkty bezpieczne.
 *
 * Świadomie NIE używamy MapLibre/Mapbox: kafle wektorowe offline to natywny
 * moduł, token, prebuild i pół dnia walki — a my i tak rysujemy lokalny układ
 * metryczny. react-native-svg wystarcza, działa w Expo Go i renderuje się
 * natychmiast. MapLibre wchodzi dopiero, jeśli zostanie czas (patrz plan, H40+).
 */
export function TrackView({
  fixes, raw, venue, size, showRaw,
}: {
  fixes: Fix[];
  raw: { x: number; y: number }[];
  venue: VenueMap | null;
  size: { w: number; h: number };
  showRaw: boolean;
}) {
  const last = fixes[fixes.length - 1];
  if (!last) return <Svg width={size.w} height={size.h} />;

  // Kamera podąża za pozycją, skala stała (2.2 px/m) — stabilny obraz na scenie.
  const S = 2.2;
  const cx = size.w / 2, cy = size.h / 2;
  const px = (x: number) => cx + (x - last.x) * S;
  const py = (y: number) => cy - (y - last.y) * S;
  const d = (p: { x: number; y: number }[]) =>
    p.map((q, i) => `${i ? 'L' : 'M'}${px(q.x).toFixed(1)},${py(q.y).toFixed(1)}`).join(' ');

  const haven = venue?.nearestHaven(last.x, last.y) ?? null;

  return (
    <Svg width={size.w} height={size.h}>
      <G>
        {venue?.walls.map((w, i) => (
          <Line key={`w${i}`} x1={px(w.ax)} y1={py(w.ay)} x2={px(w.bx)} y2={py(w.by)} stroke="#2b3a46" strokeWidth={2} />
        ))}
        {venue?.havens.map(h => (
          <G key={h.id}>
            <Circle cx={px(h.x)} cy={py(h.y)} r={7} fill="none" stroke="#22c55e" strokeWidth={2} />
            <SvgText x={px(h.x) + 11} y={py(h.y) + 4} fill="#22c55e" fontSize={11}>{h.name}</SvgText>
          </G>
        ))}
        {showRaw && <Path d={d(raw)} stroke="#f97316" strokeWidth={1.5} strokeDasharray="4 4" fill="none" />}
        <Path d={d(fixes)} stroke="#22d3ee" strokeWidth={2.5} fill="none" />
        {/* Elipsa niepewności — pokazujemy JAK BARDZO nie wiemy, zamiast udawać pewność. */}
        <Ellipse cx={cx} cy={cy} rx={Math.max(4, last.r68 * S)} ry={Math.max(4, last.r68 * S)}
          fill="#22d3ee" fillOpacity={0.10} stroke="#22d3ee" strokeOpacity={0.5} />
        <Circle cx={cx} cy={cy} r={5} fill="#e5e7eb" />
        {haven && (
          <Line x1={cx} y1={cy} x2={px(haven.haven.x)} y2={py(haven.haven.y)}
            stroke="#22c55e" strokeWidth={1.5} strokeDasharray="2 6" />
        )}
      </G>
    </Svg>
  );
}
