// ============================================================
// Ariadna / MagNav — wspólne typy rdzenia algorytmicznego.
// Zero zależności. Działa w Node (node --test) i w React Native.
// ============================================================

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { w: number; x: number; y: number; z: number };

/** Typy próbek w strumieniu/nagraniu (JSONL, jedna linia = jedna próbka). */
export type SampleType =
  | 'acc'   // akcelerometr [m/s^2], rama urządzenia
  | 'gyr'   // żyroskop [rad/s], rama urządzenia
  | 'mag'   // magnetometr skalibrowany [uT], rama urządzenia
  | 'magu'  // magnetometr NIEskalibrowany [uT] + bias
  | 'bar'   // barometr [hPa]
  | 'gps'   // fix GNSS (gdy dostępny)
  | 'mark'; // znacznik ground-truth / checkpoint

export interface BaseSample {
  /** Czas monotoniczny od startu sesji w milisekundach. JEDYNA oś czasu używana przez algorytm. */
  t: number;
  type: SampleType;
}

export interface ImuSample extends BaseSample { type: 'acc' | 'gyr' | 'mag'; x: number; y: number; z: number }
export interface MagUncalSample extends BaseSample { type: 'magu'; x: number; y: number; z: number; bx: number; by: number; bz: number }
export interface BaroSample extends BaseSample { type: 'bar'; p: number }
export interface GpsSample extends BaseSample { type: 'gps'; lat: number; lon: number; acc: number; spd?: number; alt?: number }
/** Znacznik ground truth: operator stoi fizycznie na znanym punkcie `id`. */
export interface MarkSample extends BaseSample { type: 'mark'; id: string; x?: number; y?: number }

export type Sample = ImuSample | MagUncalSample | BaroSample | GpsSample | MarkSample;

/** Nagłówek nagrania — pierwsza linia pliku .jsonl. */
export interface RecordingHeader {
  schema_version: 2;
  session_id: string;
  started_at: string;      // ISO 8601, czas ścienny (tylko do opisu, NIE do fuzji)
  device: string;          // np. "Pixel 7 / Android 14"
  user_height_cm?: number;
  venue?: string;          // klucz mapy w data/maps
  origin?: { lat: number; lon: number }; // punkt (0,0) lokalnego układu ENU
  notes?: string;
}

/** Zdarzenie "wykryto krok" — podstawowa jednostka pracy filtru cząsteczkowego. */
export interface StepEvent {
  t: number;
  /** Estymowana długość kroku [m] przed skalowaniem per-cząstka. */
  length: number;
  /** Kurs urządzenia (yaw) w ramie nawigacyjnej [rad], 0 = Północ, rosnący zgodnie z ruchem wskazówek zegara. */
  heading: number;
  /** Przyrost kursu od poprzedniego kroku [rad] — to ON jest obserwacją, nie kurs absolutny. */
  dHeading: number;
  /** Cecha magnetyczna w ramie nawigacyjnej (niezależna od obrotu telefonu). */
  mag: MagFeature | null;
  /** Wysokość względna z barometru [m] (może być null). */
  dz: number | null;
  /** Amplituda piku przyspieszenia — do diagnostyki i kalibracji K. */
  accAmp: number;
}

/** Cecha magnetyczna odporna na obrót telefonu wokół pionu. */
export interface MagFeature {
  /** |B| — moduł wektora pola [uT]. Niezmiennik obrotu. */
  f: number;
  /** Składowa pionowa (w górę) w ramie nawigacyjnej [uT]. Niezmiennik obrotu wokół pionu. */
  z: number;
  /** Moduł składowej poziomej [uT]. Niezmiennik obrotu wokół pionu. */
  h: number;
  /** true jeśli pole wygląda na "czyste" (zbliżone do ziemskiego) — wtedy magnetometr wolno użyć jako kompas. */
  clean: boolean;
}

/** Wyjście systemu po każdym kroku. */
export interface Fix {
  t: number;
  /** Pozycja w lokalnym układzie ENU [m]: x = Wschód, y = Północ. */
  x: number;
  y: number;
  /** Kowariancja pozycji [m^2] — do narysowania elipsy błędu. */
  cov: [number, number, number]; // [sxx, syy, sxy]
  /** Promień 68% (1 sigma) [m] — liczba, którą pokazujemy w UI. */
  r68: number;
  heading: number;
  /** Efektywna liczba cząstek — spadek = filtr traci pewność / rozjeżdża się. */
  nEff: number;
  /** Ile cząstek przeżyło ograniczenia mapy (0..1). */
  survival: number;
  source: 'pdr' | 'pdr+map' | 'pdr+map+mag' | 'gnss';
}
