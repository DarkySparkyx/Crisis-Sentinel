# Formaty danych i kontrakty

Wszystkie formaty mają `schema_version`. Zmiana formatu bez podniesienia wersji to
gwarantowana godzina debugowania o trzeciej w nocy.

---

## 1. Nagranie sesji — `.jsonl`

Jedna linia = jeden obiekt JSON. **Pierwsza linia to nagłówek**, kolejne to próbki
posortowane po `t`.

### Nagłówek

```json
{"schema_version":2,"session_id":"rec-1789168260056","started_at":"2026-09-11T14:32:05.221Z",
 "device":"Pixel 7 / Android 14","user_height_cm":183,"venue":"pk-korytarz-a",
 "origin":{"lat":52.2297,"lon":21.0122},"notes":"3 przejscia tam i z powrotem"}
```

`origin` definiuje punkt `(0, 0)` lokalnego układu ENU. **Musi być identyczny** w nagraniu,
w mapie obiektu i w mapie magnetycznej — inaczej wszystko będzie przesunięte.

### Próbki

| `type` | Pola | Jednostki |
|---|---|---|
| `acc` | `x, y, z` | m/s² (z grawitacją), rama urządzenia |
| `gyr` | `x, y, z` | rad/s, rama urządzenia |
| `mag` | `x, y, z` | µT, skalibrowany |
| `magu` | `x, y, z, bx, by, bz` | µT, nieskalibrowany + bias |
| `bar` | `p` | hPa |
| `gps` | `lat, lon, acc, spd?, alt?` | stopnie, m, m/s |
| `mark` | `id, x?, y?` | znacznik ground truth; `x, y` w metrach ENU |

```jsonl
{"t":1240,"type":"acc","x":0.11,"y":-0.42,"z":9.93}
{"t":1240,"type":"gyr","x":0.002,"y":-0.011,"z":0.184}
{"t":1250,"type":"magu","x":-12.4,"y":38.1,"z":-41.7,"bx":0,"by":0,"bz":0}
{"t":1260,"type":"bar","p":1008.43}
{"t":9820,"type":"mark","id":"CP03","x":30.0,"y":0.0}
```

**`t` to milisekundy od startu sesji, monotonicznie.** Nie epoch, nie nanosekundy od bootu.
Jedna oś czasu dla wszystkich czujników — bez tego fuzja nie ma sensu.

### Rozmiar
100 Hz × 3 czujniki × ~60 B ≈ **18 MB na minutę**. Dziesięciominutowe nagranie to 180 MB.
Na hakatonie do przyjęcia. Jeśli zabraknie miejsca: zejść do 50 Hz albo zapisywać binarnie.

### Plik ground truth (opcjonalny)
Obok `nazwa.jsonl` może leżeć `nazwa.truth.json` — tablica `[{t, x, y}]` z gęstą prawdą
(tylko dla danych syntetycznych). Gdy go nie ma, narzędzia budują ground truth z próbek `mark`.

---

## 2. Mapa obiektu — GeoJSON

Standardowa `FeatureCollection`. Rozpoznawane `properties.kind`:

| `kind` | Geometria | Znaczenie |
|---|---|---|
| `wall` | LineString / Polygon | nieprzekraczalna przeszkoda (twarde ograniczenie filtru) |
| `walkable` | LineString | oś korytarza / ścieżki (miękkie przyciąganie) |
| `haven` | Point | punkt bezpieczny / wyjście; wymaga `id`, `name` |
| `anchor` | Point | znany punkt kontrolny (kod QR, naklejka); wymaga `id` |

```json
{"type":"FeatureCollection",
 "properties":{"origin":{"lat":52.2297,"lon":21.0122}},
 "features":[
  {"type":"Feature","properties":{"kind":"wall","side":"left"},
   "geometry":{"type":"LineString","coordinates":[[21.0122,52.2297],[21.0126,52.2297]]}},
  {"type":"Feature","properties":{"kind":"haven","id":"H1","name":"Klatka B"},
   "geometry":{"type":"Point","coordinates":[21.0126,52.2298]}}]}
```

Bez `kind` stosowana jest heurystyka OSM: `building` → `wall`,
`highway=footway|corridor|steps|path` → `walkable`, `emergency=assembly_point` → `haven`.

Generowanie: `tools/make_venue.ts` (korytarz z pomiaru) albo `tools/osm_fetch.py` (OSM).

---

## 3. Mapa magnetyczna — JSON

```json
{"schema_version":2,"venue":"pk-korytarz-a","cell":1.0,
 "origin":{"lat":52.2297,"lon":21.0122},
 "cells":{"12,3":[47, 62.41, 3.12, -38.9, 2.05, 24.7, 1.88]}}
```

Klucz komórki: `"ix,iy"`, gdzie `ix = floor(x / cell)`, `iy = floor(y / cell)`.
Wartość: `[n, f_śr, f_std, z_śr, z_std, h_śr, h_std]` — liczba próbek i statystyki
trzech cech z `docs/02` §4.

Rozmiar: ~70 B na komórkę. Piętro 2000 m² przy siatce 1 m to ~140 kB. Bez problemu
mieści się w bundlu aplikacji.

---

## 4. API serwera OPS

Serwer jest narzędziem pomocniczym. **Nawigacja działa bez niego** — wyłączenie go
w trakcie demo nie zmienia nic poza panelem operatora.

| Metoda | Ścieżka | Opis |
|---|---|---|
| `GET` | `/api/v1/health` | stan, liczba nagrań, aktualny scenariusz |
| `GET` | `/api/v1/map/{venue}` | mapa obiektu (GeoJSON) |
| `GET` | `/api/v1/magmap/{venue}` | mapa magnetyczna |
| `POST` | `/api/v1/magmap/{venue}` | wgranie mapy zbudowanej na telefonie (multipart) |
| `POST` | `/api/v1/recordings` | wgranie nagrania `.jsonl` (multipart); waliduje nagłówek |
| `GET` | `/api/v1/recordings` | lista nagrań z nagłówkami |
| `POST` | `/api/v1/scenario/{NORMAL\|DENIED\|SPOOFED}` | przełączenie sceny demo |
| `WS` | `/ws/ops` | rozgłaszanie zmian scenariusza do telefonów i panelu |
| `GET` | `/` | panel operatora (statyczny HTML) |

**Czego świadomie NIE ma:** endpointu `map/bbox` z dynamicznym pobieraniem wycinka mapy.
Mapa jest artefaktem wgrywanym przed misją, nie zasobem ściąganym w locie — inaczej
słowo „offline” w opisie produktu przestaje być prawdziwe.

---

## 5. Zasady zmiany formatów

1. Dodanie pola opcjonalnego — **bez** podnoszenia wersji.
2. Zmiana znaczenia, jednostki albo usunięcie pola — **zawsze** `schema_version + 1`.
3. Parser odrzuca nieznaną wersję z czytelnym komunikatem, nie próbuje zgadywać.
4. Stare nagrania zostają w `data/recordings/` — są materiałem regresyjnym.
