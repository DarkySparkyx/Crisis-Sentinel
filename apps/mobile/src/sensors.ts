import { Accelerometer, Gyroscope, Magnetometer, MagnetometerUncalibrated, Barometer } from 'expo-sensors';
import type { Sample } from '@core/types.ts';

/**
 * Warstwa akwizycji. Trzy rzeczy, na których łatwo się przejechać:
 *
 * 1. CZAS. expo-sensors podaje `timestamp` w różnych jednostkach zależnie od
 *    platformy i wersji. Nie ufamy mu: stemplujemy próbki własnym, monotonicznym
 *    zegarem sesji (performance.now od momentu start()). Jedna oś czasu dla
 *    wszystkich czujników = warunek konieczny poprawnej fuzji.
 * 2. CZĘSTOTLIWOŚĆ. setUpdateInterval to SUGESTIA. Android od API 31 ogranicza
 *    do 200 Hz bez uprawnienia HIGH_SAMPLING_RATE_SENSORS. Realnie dostaniemy
 *    50-100 Hz — i to wystarczy (detekcja kroku potrzebuje >= 50 Hz).
 * 3. WĄTEK. Callbacki lecą po moście do JS. NIE wolno w nich robić setState —
 *    zabijesz UI. Wrzucamy do Pipeline (czysta matematyka) i odświeżamy ekran
 *    osobnym timerem 5-10 Hz.
 */
export type SampleSink = (s: Sample) => void;

export interface SensorConfig {
  /** Docelowy interwał IMU [ms]. 10 ms = 100 Hz. */
  imuIntervalMs: number;
  magIntervalMs: number;
  baroIntervalMs: number;
  /** Użyć magnetometru nieskalibrowanego (zalecane: mamy wtedy bias osobno). */
  uncalibrated: boolean;
}

export const DEFAULT_SENSOR_CONFIG: SensorConfig = {
  imuIntervalMs: 10,
  magIntervalMs: 20,
  baroIntervalMs: 200,
  uncalibrated: true,
};

export class SensorHub {
  private subs: { remove: () => void }[] = [];
  private t0 = 0;
  running = false;
  /** Liczniki do diagnostyki — pokaż je w UI, żeby od razu widzieć martwy czujnik. */
  counts = { acc: 0, gyr: 0, mag: 0, bar: 0 };

  constructor(private sink: SampleSink, private cfg: SensorConfig = DEFAULT_SENSOR_CONFIG) {}

  private now(): number { return Math.round(globalThis.performance?.now?.() ?? Date.now()) - this.t0; }

  async start(): Promise<void> {
    if (this.running) return;
    this.t0 = Math.round(globalThis.performance?.now?.() ?? Date.now());
    this.running = true;

    Accelerometer.setUpdateInterval(this.cfg.imuIntervalMs);
    Gyroscope.setUpdateInterval(this.cfg.imuIntervalMs);

    this.subs.push(Accelerometer.addListener(({ x, y, z }) => {
      this.counts.acc++;
      // UWAGA: expo-sensors zwraca akcelerometr w jednostkach g, nie m/s^2.
      this.sink({ t: this.now(), type: 'acc', x: x * 9.80665, y: y * 9.80665, z: z * 9.80665 });
    }));
    this.subs.push(Gyroscope.addListener(({ x, y, z }) => {
      this.counts.gyr++;
      this.sink({ t: this.now(), type: 'gyr', x, y, z }); // rad/s
    }));

    if (this.cfg.uncalibrated) {
      MagnetometerUncalibrated.setUpdateInterval(this.cfg.magIntervalMs);
      this.subs.push(MagnetometerUncalibrated.addListener(({ x, y, z }) => {
        this.counts.mag++;
        // Expo nie wystawia osobno biasu -> zapisujemy zera i liczymy bias sami (fitHardIron).
        this.sink({ t: this.now(), type: 'magu', x, y, z, bx: 0, by: 0, bz: 0 });
      }));
    } else {
      Magnetometer.setUpdateInterval(this.cfg.magIntervalMs);
      this.subs.push(Magnetometer.addListener(({ x, y, z }) => {
        this.counts.mag++;
        this.sink({ t: this.now(), type: 'mag', x, y, z }); // uT
      }));
    }

    try {
      if (await Barometer.isAvailableAsync()) {
        Barometer.setUpdateInterval(this.cfg.baroIntervalMs);
        this.subs.push(Barometer.addListener(({ pressure }) => {
          this.counts.bar++;
          this.sink({ t: this.now(), type: 'bar', p: pressure }); // hPa
        }));
      }
    } catch { /* brak barometru — system działa dalej, tylko bez detekcji pięter */ }
  }

  stop(): void {
    this.subs.forEach(s => s.remove());
    this.subs = [];
    this.running = false;
  }

  mark(id: string, x?: number, y?: number): void {
    this.sink({ t: this.now(), type: 'mark', id, x, y });
  }
}
