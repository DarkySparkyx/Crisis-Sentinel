# Ariadna — plan implementacji na 48 h, zespół 3–4 osoby

## 0. Co budujemy (jedno zdanie)

**Telefon z Androidem, w trybie samolotowym, wie gdzie jest z dokładnością poniżej 2 m —
bo czyta anomalie magnetyczne budynku jak odcisk palca, a nie dlatego, że łapie jakikolwiek
sygnał z zewnątrz.**

Trzy źródła informacji, żadne z nich nie wymaga infrastruktury:

1. **Inercja** — akcelerometr + żyroskop dają kroki i skręty (PDR). Sama w sobie dryfuje.
2. **Magnetyzm** — każde miejsce w budynku ma własny, stabilny w czasie „podpis” pola
   magnetycznego. Dopasowanie do mapy kasuje dryf.
3. **Geometria** — ściany i korytarze. Cząstka, która przeszła przez ścianę, jest odrzucana.

Spina je **filtr cząsteczkowy**, który zwraca nie punkt, tylko rozkład — czyli pozycję
**wraz z uczciwą miarą niepewności**.

### Dlaczego to jest innowacyjne (i co odpowiedzieć jury)

| Pytanie | Odpowiedź |
|---|---|
| To już jest — IndoorAtlas robi to od 2012. | Tak, ale wymaga chmury i płatnego, profesjonalnego surveyu obiektu. U nas mapa powstaje **w locie, przez pierwszego użytkownika, który wejdzie do budynku**, a lokalizacja liczy się **w całości na telefonie w trybie samolotowym**. |
| To zwykły krokomierz. | Sam PDR dryfuje ~14% przebytej drogi (zmierzone). Dołożenie mapy magnetycznej i geometrii schodzi do **0,5%**. To różnica między „gdzieś na tym piętrze” a „przy tych drzwiach”. |
| Skąd wiadomo, że nie kłamie? | Bo pokazuje elipsę błędu, a ta elipsa jest **skalibrowana**: w 71% przypadków prawdziwa pozycja mieści się wewnątrz deklarowanego 1σ (teoria mówi 68%). Mierzymy to i pokazujemy. |

---

## 1. Architektura

```
                 TELEFON (offline, tryb samolotowy)
  ┌─────────────────────────────────────────────────────────┐
  │ expo-sensors ──► Pipeline (packages/core, czysty TS)    │
  │  acc gyr mag     ├─ AttitudeFilter  orientacja + ZARU   │
  │  baro gnss       ├─ StepDetector    kroki + długość     │
  │                  ├─ magFeature      cecha niezmiennicza │
  │                  └─ ParticleFilter  ◄── MagMap (mapa    │
  │                       │                  magnetyczna)   │
  │                       │             ◄── VenueMap (ściany)│
  │                       ▼                                  │
  │                   Fix {x, y, r68, heading}               │
  │                       ├──► TrackView (react-native-svg)  │
  │                       └──► Recorder (.jsonl na dysk)     │
  └─────────────────────────────────────────────────────────┘
            ▲ mapy wgrane przed misją      ▼ nagrania po misji
  ┌─────────────────────────────────────────────────────────┐
  │ apps/ops (FastAPI) — POZA ŚCIEŻKĄ KRYTYCZNĄ             │
  │  • odbiera nagrania   • wydaje mapy   • panel demo       │
  └─────────────────────────────────────────────────────────┘
            ▲
  ┌─────────────────────────────────────────────────────────┐
  │ packages/replay (Node) — narzędzie zespołu               │
  │  synth │ run │ survey │ sweep  →  RMSE, CEP, SVG         │
  │  TEN SAM kod rdzenia co na telefonie                     │
  └─────────────────────────────────────────────────────────┘
```

**Zasada nadrzędna:** `packages/core` nie importuje niczego z Reacta, Node ani Expo.
Dzięki temu ta sama matematyka działa w aplikacji i w narzędziu do strojenia — i nie ma
dwóch rozjeżdżających się wersji algorytmu.

### Stos technologiczny i uzasadnienia

| Warstwa | Wybór | Dlaczego nie alternatywa |
|---|---|---|
| Rdzeń algorytmu | TypeScript, zero zależności | Node 22 uruchamia `.ts` natywnie, Metro też. Jedna implementacja zamiast JS + Python. |
| Aplikacja | Expo SDK 52, **Expo Go** | Bez `prebuild`, bez dev clienta, bez czekania 40 min na build. Warunek: żadnych modułów natywnych spoza Expo. |
| Mapa na ekranie | `react-native-svg` | MapLibre/Mapbox = moduł natywny + token + kafle offline = pół dnia. My i tak rysujemy lokalny układ metryczny. |
| Matematyka przestrzenna | własna, 60 linii | Turf.js to 500 kB pod WGS84; nasze dystanse to 1–200 m w metrach. |
| Serwer | FastAPI, 3 zależności | Bez GeoPandas/GDAL — instalacja potrafi zjeść pół nocy. |
| Testy | `node --test` | Wbudowane. Zero konfiguracji. |

---

## 2. Role i podział pracy

Katalogi są rozłączne — to celowe, żeby ograniczyć konflikty w gicie.

| Rola | Kto | Katalogi | Odpowiada za |
|---|---|---|---|
| **A — Rdzeń** | najmocniejszy programista | `packages/core/src/{attitude,steps,pf,magfeat}.ts` | Orientacja, kroki, filtr cząsteczkowy, strojenie. To jest ścieżka krytyczna. |
| **B — Aplikacja** | RN/frontend | `apps/mobile/**` | Akwizycja czujników, nagrywanie, UI, tryby NAV/SURVEY/RECORD. |
| **C — Mapy i dane** | ktokolwiek | `packages/core/src/{magmap,graph,geojson}.ts`, `tools/**`, `data/**` | Mapa obiektu, mapa magnetyczna, formaty, przejścia kalibracyjne. |
| **D — Ewaluacja i demo** | ktokolwiek | `packages/replay/**`, `apps/ops/**`, `docs/04` | Metryki, wykresy, panel operatora, nagrania, pitch. |

Przy **3 osobach**: łączymy C i D w jedną rolę „Dane i demo”, a A przejmuje `magmap.ts`.

**Reguła dnia:** co 4 godziny 10-minutowy przegląd — każdy pokazuje **liczbę albo ekran**,
nie opis postępu.

---

## 3. Harmonogram

Godziny liczone od startu. Każda faza ma **bramkę** — dopóki nie jest spełniona,
nie idziemy dalej.

### H0–H4 · Fundament i narzędzia (wszyscy)

Kolejność jest tu odwrotna niż w oryginalnym planie i to jest najważniejsza zmiana
w całym dokumencie: **narzędzia do strojenia powstają przed algorytmem.**

- [ ] **A** Repo, `npm test` przechodzi, rdzeń kompiluje się w Node.
- [ ] **B** `npx create-expo-app`, Expo Go na telefonie **każdej osoby**, ekran z surowymi
      odczytami trzech czujników i licznikiem Hz. *Weryfikacja od razu: czy akcelerometr
      podaje ~9,81 czy ~1,0? (Expo zwraca g, nie m/s².)*
- [ ] **D** `packages/replay`: generator syntetyczny + metryki + rysunek SVG.
- [ ] **C** Pomiar korytarza demo (taśma/dalmierz/kroki), `tools/make_venue.ts` → GeoJSON.

> **BRAMKA H4:** `npm run demo` wypisuje RMSE i zapisuje SVG. Telefon każdej osoby pokazuje
> odczyty czujników. Dopiero teraz zaczynamy algorytm.

### H4–H12 · Inercja: kroki i kurs (A prowadzi)

- [ ] Filtr orientacji z ZARU (estymacja biasu żyroskopu w postoju).
- [ ] Detekcja kroku na rzucie przyspieszenia na wektor grawitacji.
- [ ] Długość kroku (Weinberg) + procedura kalibracji K na 20 m.
- [ ] **B** równolegle: `Recorder` zapisujący `.jsonl` + przycisk CHECKPOINT (ground truth).
- [ ] **Pierwsze prawdziwe nagranie** — 100 m korytarza z 5 checkpointami.

> **BRAMKA H12:** na prawdziwym nagraniu liczba wykrytych kroków ±5% względem policzonych
> ręcznie; błąd zamknięcia pętli czystego PDR poniżej 20% drogi. (Tak, 20% — to *ma* być
> słabe, po to jest reszta systemu.)

### H12–H22 · Filtr cząsteczkowy + geometria (A + C)

- [ ] `ParticleFilter` ze stanem `(x, y, kurs, skala kroku, bias skrętu)`.
- [ ] Twarde ograniczenie ścianami (`VenueMap.crossesWall`) + indeks przestrzenny.
- [ ] Miękkie przyciąganie do osi korytarza.
- [ ] Strojenie `sigmaTurn`, `sigmaLen`, `roughening` przez `npm run sweep`.

> **BRAMKA H22:** na nagraniu z H12, z samą mapą budynku (bez mapy magnetycznej),
> błąd zamknięcia pętli **poniżej 3%** drogi. Na danych syntetycznych osiągamy 0,7%.

### H22–H32 · Warstwa magnetyczna (A + C)

- [ ] Cecha `(|B|, B_pion, |B_poziom|)` niezmiennicza na obrót telefonu.
- [ ] Kalibracja hard-iron (`fitHardIron`) — procedura „ósemki” w aplikacji.
- [ ] `MagMap`: siatka 1 m, statystyki Welforda, serializacja.
- [ ] Tryb SURVEY + `replay survey` (mapa z interpolacji między checkpointami).
- [ ] **Przejście kalibracyjne korytarza demo** — 2–3 przejścia tam i z powrotem.
- [ ] Włączenie obserwacji magnetycznej do filtru.

> **BRAMKA H32:** mapa magnetyczna pokrywa trasę demo; CEP50 **poniżej 2 m** względem
> checkpointów. Na danych syntetycznych: CEP50 = 0,46 m, RMSE = 0,92 m.

### H32–H40 · Produkt i scena (B + D)

- [ ] UI: strzałka do najbliższego punktu bezpiecznego, dystans, **elipsa niepewności**.
- [ ] Porównanie „czyste PDR vs nasz system” jako przełącznik na ekranie — to jest *ten*
      obrazek, który sprzedaje projekt.
- [ ] Panel operatora (`apps/ops`) i scenariusze NORMAL / DENIED / SPOOFED.
- [ ] Detektor niespójności GNSS (spoofing).
- [ ] Tryb REPLAY na telefonie, z wyraźną etykietą na ekranie.
- [ ] 3 nagrania zapasowe + film z udanego przejścia.

> **BRAMKA H40: ZAMROŻENIE KODU.** Od tej godziny żadnych nowych funkcji. Tylko poprawki
> awarii i próby. Ta reguła jest nienegocjowalna — złamanie jej to najczęstsza przyczyna
> nieudanej prezentacji na hakatonie.

### H40–H48 · Próby i pitch (wszyscy)

- [ ] Próba przejścia na docelowej scenie, z projektorem i scrcpy — **minimum 3 razy**.
- [ ] Tabela wyników z prawdziwych przejść (nie syntetycznych) do slajdu.
- [ ] Pitch: 5 min, przećwiczony z zegarkiem.
- [ ] Plan awaryjny: telefon zapasowy z tym samym buildem, powerbank, film.

---

## 4. Metryki — czym mierzymy „działa”

Wszystkie liczy `packages/replay` automatycznie z każdego nagrania.

| Metryka | Co mówi | Cel MVP | Cel ambitny |
|---|---|---|---|
| **Błąd zamknięcia pętli** | wracasz do punktu startu — o ile chybiłeś | < 3% drogi | < 1% |
| **CEP50** | połowa pomiarów jest bliżej niż ta wartość | < 2 m | < 1 m |
| **CEP95** | ogon rozkładu — tu żyją awarie | < 5 m | < 3 m |
| **Kalibracja niepewności** | ile % przypadków mieści się w deklarowanym 1σ | 55–85% | 65–72% |
| **Dryf kursu** | ile stopni na minutę ucieka żyroskop | < 5°/min | < 2°/min |
| **Błąd liczby kroków** | sanity check detektora | < 5% | < 2% |

### Jak zdobyć ground truth bez drogiego sprzętu

1. **Znaczniki na podłodze** — taśma malarska co 10 m wzdłuż korytarza, zmierzone
   dalmierzem lub taśmą. Operator naciska CHECKPOINT stojąc na znaczniku.
2. **Pętla zamknięta** — start i meta w tym samym punkcie. Błąd zamknięcia nie wymaga
   żadnego sprzętu i jest najbardziej przekonującą liczbą w całej prezentacji.
3. **Dane syntetyczne** — ground truth co do centymetra, do testów regresyjnych
   (`npm test`). Nie zastępują prawdziwych, ale wyłapują błędy w minutę zamiast w godzinę.

### Wyniki bazowe na danych syntetycznych

Pętla 96 m, bias żyroskopu 0,008 rad/s, średnia z 5 niezależnych przebiegów:

| Konfiguracja | RMSE | CEP50 | CEP95 | Zamknięcie pętli | Kalibracja 1σ |
|---|---|---|---|---|---|
| Sam krokomierz (PDR) | 5,08 m | 3,75 m | 11,03 m | 13,35 m (13,9%) | — |
| Filtr bez żadnej mapy | 7,81 m | 6,66 m | 14,53 m | 17,20 m (17,9%) | 100% |
| Filtr + geometria budynku | 1,63 m | 1,11 m | 3,39 m | 1,03 m (1,1%) | 50% |
| Filtr + mapa magnetyczna | 0,60 m | 0,57 m | 0,87 m | 0,35 m (0,4%) | 94% |
| **Filtr + obie mapy** | **0,57 m** | **0,45 m** | **1,02 m** | **0,51 m (0,5%)** | 58% |

Odtworzenie: `npm run bench`. Mapa magnetyczna budowana z przejścia kalibracyjnego
(seed 7), ocena na **pięciu innych** przejściach — bez tego podziału wyniki mierzyłyby
zdolność algorytmu do zapamiętania szumu, a nie dokładność.

> **Zwróć uwagę na drugi wiersz.** Filtr cząsteczkowy *bez żadnej obserwacji* jest **gorszy**
> niż czyste PDR, bo dokłada szum, a nie ma czym go skorygować. To ważna lekcja i dobry
> materiał na pytanie od jury: filtr nie jest magią, filtr jest sposobem łączenia
> informacji — bez informacji nie ma czego łączyć.
>
> **I uczciwe zastrzeżenie:** to są dane syntetyczne. Realne wyniki będą gorsze —
> prawdziwe pole magnetyczne jest mniej regularne, telefon nie jest trzymany idealnie,
> a ludzie chodzą nierówno. Liczby z prawdziwych przejść wchodzą do slajdu dopiero
> po fazie H32. Na scenie mówimy, które liczby skąd są.

---

## 5. Ryzyka i reakcje

| Ryzyko | Prawdopodobieństwo | Reakcja |
|---|---|---|
| Żyroskop dryfuje szybciej niż zakładamy | wysokie | ZARU + bias jako składowa stanu filtru; kotwice co 30–50 m |
| Filtr „ucieka” i nie wraca | średnie | Roughening (nastrojony), monitoring `N_eff`, przycisk „reset do kotwicy” |
| Mapa magnetyczna za wąska (1 przejście) | wysokie | Fallback do sąsiednich komórek (`searchRadius`), min. 2 przejścia tam-powrót |
| Telefon inny niż ten, na którym robiono mapę | średnie | Kalibracja hard-iron przed każdą sesją; cechy są niezmiennicze na obrót |
| Expo Go nie daje dość Hz | niskie | Zmierzyć w H0–H4. Jeśli < 50 Hz — dev client z `expo-sensors` i `HIGH_SAMPLING_RATE_SENSORS` |
| Brak Wi-Fi na sali | wysokie | Wszystko offline; serwer tylko na hotspocie telefonu, i tak nieobowiązkowy |
| Bateria pada w trakcie demo | średnie | Powerbank, `expo-keep-awake`, jasność w dół, telefon zapasowy z tym samym buildem |
| Demo live się sypie | średnie | REPLAY na telefonie (nie z laptopa), z etykietą; w ostateczności film |

---

## 6. Zadania dla osoby dołączającej drugiego dnia

Wszystkie są rozłączne z rdzeniem algorytmu — zero konfliktów w gicie.

**Zadanie 1 · Mapa obiektu (2–3 h)**
Zmierz korytarz demo (dalmierz albo taśma; krokami z kalibracją też wystarczy).
Uruchom `node tools/make_venue.ts --waypoints '[[0,0],[28,0],[28,15]]' --width 2.4`.
Zweryfikuj wynik: `node packages/replay/src/cli.ts run <nagranie> --venue <plik> --svg out.svg`
— ślad musi mieścić się między ścianami. Dla terenu otwartego: `tools/osm_fetch.py`.

**Zadanie 2 · Przejścia kalibracyjne i mapa magnetyczna (3–4 h)**
Nakleić taśmą znaczniki co 10 m. Przejść trasę 3× w obie strony w trybie RECORD,
naciskając CHECKPOINT na każdym znaczniku. Zbudować mapę:
`node packages/replay/src/cli.ts survey <nagranie> --out data/magmaps/venue.json`.
Sprawdzić pokrycie (raportowane w m²) i że mapa poprawia CEP50 na *innym* nagraniu
niż to, z którego powstała. **To jest test na przeuczenie — bez niego wyniki są nic niewarte.**

**Zadanie 3 · Panel operatora i przebieg prezentacji (2 h)**
`apps/ops` — uruchomić, przetestować trzy scenariusze, napisać scenariusz demo minuta
po minucie (`docs/04`), przećwiczyć przełączanie.

---

## 7. Definicja „skończone” dla MVP

System jest gotowy, gdy na **prawdziwym** nagraniu z korytarza demo:

1. błąd zamknięcia pętli < 3% przebytej drogi,
2. CEP50 względem checkpointów < 2 m,
3. deklarowana niepewność mieści się w przedziale 55–85% pokrycia,
4. aplikacja przechodzi cykl START → marsz → STOP bez restartu i bez zacięć UI,
5. `npm test` przechodzi,
6. istnieje nagranie zapasowe, z którego demo można odtworzyć na telefonie.
