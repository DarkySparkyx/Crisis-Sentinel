import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions, ScrollView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import { Pipeline } from '@core/pipeline.ts';
import { MagMap } from '@core/magmap.ts';
import { loadVenue } from '@core/geojson.ts';
import type { Fix, Sample } from '@core/types.ts';
import { SensorHub } from './src/sensors';
import { Recorder } from './src/recorder';
import { TrackView } from './src/TrackView';
import venueJson from './assets/venue.json';
import magmapJson from './assets/magmap.json';

/**
 * SZKIELET aplikacji. Trzy tryby, jeden ekran:
 *   NAV     — nawigacja (to widzi użytkownik końcowy)
 *   SURVEY  — budowanie mapy magnetycznej (to robi pierwszy ratownik)
 *   RECORD  — nagrywanie surowych danych do strojenia offline (to robi zespół)
 *
 * Zasada: cała matematyka w Pipeline (packages/core), tutaj tylko widok.
 * Stan ekranu odświeżamy timerem 8 Hz, NIGDY w callbacku czujnika.
 */
type Mode = 'NAV' | 'SURVEY' | 'RECORD';

export default function App() {
  useKeepAwake();
  const { width, height } = useWindowDimensions();
  const [mode, setMode] = useState<Mode>('NAV');
  const [running, setRunning] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [tick, setTick] = useState(0);
  const [status, setStatus] = useState('gotowy');

  const venue = useMemo(() => loadVenue(venueJson as any, (venueJson as any).properties?.origin ?? { lat: 0, lon: 0 }), []);
  const pipe = useRef<Pipeline | null>(null);
  const hub = useRef<SensorHub | null>(null);
  const rec = useRef(new Recorder());

  const boot = () => {
    const p = new Pipeline({ mode: mode === 'SURVEY' ? 'SURVEY' : 'NAV', pf: { n: 1000 } });
    p.attachVenue(venue);
    if (mode === 'SURVEY') p.attachMagMap(new MagMap('venue', 1.0, venue ? { lat: 0, lon: 0 } : { lat: 0, lon: 0 }));
    else if ((magmapJson as any)?.cells) p.attachMagMap(MagMap.fromJSON(magmapJson as any));
    // Punkt startowy: na razie środek pierwszego safe haven. Docelowo: fix GNSS
    // sprzed wejścia, kod QR w drzwiach albo wskazanie palcem na mapie.
    const h = venue.havens[0];
    p.start(h?.x ?? 0, h?.y ?? 0, 0);
    pipe.current = p;
    return p;
  };

  const onSample = (s: Sample) => {
    pipe.current?.push(s);
    if (mode === 'RECORD') rec.current.push(s);
  };

  const start = async () => {
    const p = boot();
    hub.current = new SensorHub(onSample);
    if (mode === 'RECORD') {
      const path = await rec.current.start({
        schema_version: 2, session_id: `rec-${Date.now()}`, started_at: new Date().toISOString(),
        device: 'android', venue: 'venue',
      });
      setStatus(`nagrywam -> ${path.split('/').pop()}`);
    } else setStatus(`${mode} aktywny`);
    await hub.current.start();
    setRunning(true);
    void p;
  };

  const stop = async () => {
    hub.current?.stop();
    setRunning(false);
    if (mode === 'RECORD') { const p = await rec.current.stop(); setStatus(`zapisano ${p.split('/').pop()}`); await rec.current.share(); }
    else setStatus('zatrzymany');
  };

  useEffect(() => {
    const id = setInterval(() => {
      const f = pipe.current?.fixes.at(-1) ?? null;
      setFix(f);
      setTick(t => t + 1);
    }, 125);
    return () => clearInterval(id);
  }, []);

  const haven = fix && venue ? venue.nearestHaven(fix.x, fix.y) : null;
  const bearing = haven && fix
    ? ((Math.atan2(haven.haven.x - fix.x, haven.haven.y - fix.y) - fix.heading) * 180) / Math.PI
    : 0;
  const c = hub.current?.counts;

  return (
    <View style={s.root}>
      <StatusBar style="light" />
      <View style={s.top}>
        <Text style={s.badge}>GNSS: <Text style={{ color: '#f87171' }}>BRAK</Text></Text>
        <Text style={s.badge}>MAG: {pipe.current?.magmap?.size ?? 0} kom.</Text>
        <Text style={s.badge}>IMU: {c ? `${c.acc}/${c.gyr}/${c.mag}` : '—'}</Text>
        <Text style={s.badge}>N_eff: {fix ? fix.nEff.toFixed(0) : '—'}</Text>
      </View>

      <TrackView
        fixes={pipe.current?.fixes ?? []}
        raw={pipe.current?.rawPDR ?? []}
        venue={venue}
        size={{ w: width, h: height - 300 }}
        showRaw
      />

      <View style={s.bottom}>
        <Text style={s.big}>
          {haven ? `${haven.dist.toFixed(0)} m` : '—'}
          <Text style={s.unit}>  do {haven?.haven.name ?? 'celu'}</Text>
        </Text>
        <Text style={s.sub}>
          niepewność ±{fix ? fix.r68.toFixed(1) : '—'} m (1σ) · kroki {pipe.current?.steps.length ?? 0} · źródło {fix?.source ?? '—'}
        </Text>
        <Text style={[s.sub, { color: '#22d3ee' }]}>skręć {bearing > 0 ? '→' : '←'} {Math.abs(bearing).toFixed(0)}°</Text>
        <Text style={s.status}>{status}</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
          {(['NAV', 'SURVEY', 'RECORD'] as Mode[]).map(m => (
            <Pressable key={m} onPress={() => !running && setMode(m)}
              style={[s.chip, mode === m && s.chipOn, running && { opacity: 0.4 }]}>
              <Text style={[s.chipTxt, mode === m && { color: '#0b0f14' }]}>{m}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => hub.current?.mark(`CP${Date.now() % 10000}`)} style={s.chip}>
            <Text style={s.chipTxt}>◉ CHECKPOINT</Text>
          </Pressable>
        </ScrollView>

        <Pressable onPress={running ? stop : start} style={[s.btn, running && { backgroundColor: '#ef4444' }]}>
          <Text style={s.btnTxt}>{running ? 'STOP' : 'START'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0f14' },
  top: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 48, paddingHorizontal: 14, paddingBottom: 8 },
  badge: { color: '#94a3b8', fontSize: 11, fontFamily: 'monospace' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: '#0b0f14ee' },
  big: { color: '#e5e7eb', fontSize: 40, fontWeight: '700' },
  unit: { fontSize: 14, color: '#94a3b8', fontWeight: '400' },
  sub: { color: '#94a3b8', fontSize: 12, fontFamily: 'monospace', marginTop: 2 },
  status: { color: '#64748b', fontSize: 11, marginTop: 6 },
  chip: { borderWidth: 1, borderColor: '#334155', borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12, marginRight: 8 },
  chipOn: { backgroundColor: '#22d3ee', borderColor: '#22d3ee' },
  chipTxt: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  btn: { marginTop: 12, backgroundColor: '#22d3ee', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  btnTxt: { color: '#0b0f14', fontWeight: '800', fontSize: 16, letterSpacing: 1 },
});
