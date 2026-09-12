# Plan v2 — dwa tryby, jeden rdzeń. 48 h, 3–4 osoby

Zastępuje `docs/01-PLAN-IMPLEMENTACJI.md` w części dotyczącej zakresu i harmonogramu.
Analiza, z której wynika ten plan: `docs/10-ANALIZA-PRZYPADKOW.md`.

---

## 1. Teza produktu

> **Budynek, podziemia, strefa zagłuszania: nie wiesz, gdzie jesteś.
> Las i góry: wiesz, ale nie masz jak nikomu powiedzieć.
> Jeden telefon rozwiązuje oba, bez żadnej infrastruktury.**

Zdanie na scenę, jedno: *turysta bez zasięgu w polskich górach nie ma dziś żadnej
drogi przekazania swojej pozycji — Apple SOS przez satelitę nie obejmuje Polski,
SMS na 112 nie istnieje, RATUNEK wymaga sieci. My mieścimy cały dzień wędrówki
w jednej wiadomości SMS.*

---

## 2. Trzy tory, jedna baza kodu

| Tor | Co to jest | Stan |
|---|---|---|
| **A — Łączność** | ślad skompresowany do 120 B + wysyłka przy pierwszym oknie | rdzeń **gotowy i przetestowany** |
| **B — Pozycja w terenie** | GNSS + PDR + graf szlaków + wysokość | do zbudowania, ~80% kodu z toru C |
| **C — Pozycja w budynku** | anomalie magnetyczne + ściany | **działa, nie ruszamy** |

Tor C nie jest zaszłością do wyrzucenia — jest **dowodem dual-use**. Ten sam filtr
cząsteczkowy, ta sama detekcja kroku, to samo ograniczenie mapą; zmienia się
wyłącznie obserwacja: raz pole magnetyczne stalowej konstrukcji, raz profil terenu.

### Co już jest zrobione i przetestowane

```
packages/core/src/track.ts        kodek śladu -> 120 B / 160 znaków SMS   ← NOWE, 11 testów
packages/core/src/pf.ts           filtr cząsteczkowy (x, y, kurs, k, bias)
packages/core/src/attitude.ts     orientacja + ZARU (estymacja biasu żyroskopu)
packages/core/src/steps.ts        detekcja kroku + model Weinberga
packages/core/src/graph.ts        graf ścieżek + ściany z indeksem przestrzennym
packages/core/src/magmap.ts       mapa magnetyczna (tryb budynkowy)
packages/replay/**                generator danych, metryki, sweepy, benchmark
apps/mobile/**                    akwizycja czujników, nagrywanie, UI, mapa SVG
apps/ops/**                       serwer pomocniczy + panel operatora
```

**31 testów przechodzi.** Kodek jest jedynym całkowicie nowym elementem i jest
gotowy — najtrudniejsza część toru A została zdjęta z harmonogramu.

---

## 3. Zakres na 48 h, z liniami cięcia

Reguła: jeśli o godzinie 30 pozycja z listy SHOULD nie działa, wypada. Bez dyskusji.

### MUST — bez tego nie ma dema

| # | Zadanie | Tor | Skąd startujemy |
|---|---|---|---|
| M1 | Ciągły zapis trasy w aplikacji (GNSS gdy jest, PDR gdy nie ma) | A | `Recorder` istnieje, dochodzi wątek pozycji |
| M2 | Ekran „wyślij pozycję” + kodek → treść SMS-a | A | kodek gotowy, trzeba podłączyć UI |
| M3 | Odbiornik: wklej SMS → trasa na mapie (strona w `apps/ops`) | A | nowa strona, ~150 linii |
| M4 | Fuzja GNSS + PDR z bramkowaniem jakości fixa | B | nowy `gnss.ts`, wpina się w `Pipeline` |
| M5 | Ograniczenie grafem szlaków z OSM | B | `VenueMap.walkable` **już to robi** |
| M6 | Automatyczne przełączanie trybu budynek ↔ teren | B/C | reguła na jakości fixa i cechy magnetycznej |
| M7 | Nagranie terenowe przed budynkiem + metryki | wszystkie | `Recorder` + `replay` istnieją |

### SHOULD — mocno podnosi pitch, ale wycinalne

| # | Zadanie | Tor | Ryzyko |
|---|---|---|---|
| S1 | Obserwacja wysokościowa: barometr + DEM | B | pobranie i wpięcie DEM, ~4 h |
| S2 | Wysyłka oportunistyczna (burst przy pojawieniu się sieci) | A | zależna od zachowania Androida w tle |
| S3 | Detektor utraty i podrobienia GNSS | B | prosty, ale wymaga danych do pokazania |

### CUT — nie zaczynamy, chyba że wszystko powyżej działa o godzinie 36

Przekaźnik BLE między telefonami · obsługa pięter · estymacja misalignmentu ·
MapLibre z kaflami offline · integracja z prawdziwym 112.

---

## 4. Jedna rzecz, którą trzeba wiedzieć, zanim zacznie się kodować SMS

**Android nie pozwala aplikacji wysłać SMS-a po cichu.** Uprawnienie `SEND_SMS` jest
mocno ograniczone przez Google Play, a `expo-sms` **otwiera edytor wiadomości**
z przygotowaną treścią — użytkownik musi dotknąć „wyślij”. To nie jest wada
demonstracyjna, tylko fakt platformy.

Dlatego kanały układamy tak:

1. **SMS — podłoga możliwości.** Treść gotowa, jedno dotknięcie. Pokazujemy ją na
   scenie, bo to jedyny kanał, który przechodzi przy jednej kresce zasięgu.
   To także dowód, że pakiet naprawdę mieści się w 160 znakach.
2. **Burst HTTP — kanał automatyczny.** 120 bajtów przechodzi w każdym oknie
   transmisji dłuższym niż ułamek sekundy. To jest realna droga automatyczna
   i to ją uruchamiamy w tle.
3. **Czarna skrzynka — gdy nie było żadnego okna.** Ślad zostaje na telefonie
   i jest odczytywany po odnalezieniu.

Na scenie mówimy to wprost. Udawanie, że aplikacja wysyła SMS-y samoczynnie,
to dokładnie ten rodzaj rzeczy, który jury wyłapuje.

---

## 5. Role

Katalogi rozłączne — mniej konfliktów w gicie.

| Rola | Odpowiada za | Katalogi |
|---|---|---|
| **A — Fuzja** | M4, M6, S1, S3 | `packages/core/src/{gnss,terrain,pipeline}.ts` |
| **B — Aplikacja** | M1, M2, M6 (UI), S2 | `apps/mobile/**` |
| **C — Dane i mapy** | M5, M7, DEM, szlaki OSM | `tools/**`, `data/**`, `packages/core/src/graph.ts` |
| **D — Odbiór i demo** | M3, metryki, panel, pitch | `apps/ops/**`, `packages/replay/**`, `docs/**` |

Przy trzech osobach: C i D łączą się, a A przejmuje `graph.ts`.

---

## 6. Harmonogram

Każda faza ma bramkę. Nie ma bramki — nie idziemy dalej.

### H0–H4 · Rozpoznanie terenu i dane (wszyscy)

- [ ] **C** Pobrać szlaki z OSM dla obszaru wokół miejsca hakatonu (`tools/osm_fetch.py` gotowy) i **sprawdzić wzrokowo**, czy graf pokrywa trasę, po której będziecie chodzić.
- [ ] **C** Pobrać DEM dla tego samego obszaru (Copernicus 30 m albo NMT z GUGiK).
- [ ] **B** Dodać do aplikacji zapis pozycji GNSS do nagrania (`expo-location`, typ próbki `gps` już jest w formacie).
- [ ] **wszyscy** **Pierwszy spacer**: 300–500 m przed budynkiem, tryb RECORD, checkpointy co 50 m taśmą albo widocznym punktem.

> **BRAMKA H4:** w `data/recordings/` leży nagranie terenowe z fixami GNSS i checkpointami,
> a `npm run replay` liczy z niego metryki. Bez tego reszta to zgadywanie.

### H4–H12 · Tor B: pozycja w terenie (A + C)

- [ ] `gnss.ts`: przyjmowanie fixa jako obserwacji filtru z wagą zależną od raportowanej dokładności; odrzucanie fixów niespójnych z PDR.
- [ ] Wpięcie grafu szlaków jako miękkiego przyciągania (`walkablePull` — parametr już istnieje).
- [ ] Strojenie na nagraniu z H4 przez `npm run sweep`.

> **BRAMKA H12:** na nagraniu terenowym, z **wyłączonym GNSS w połowie trasy**,
> błąd na końcu poniżej **5% przebytej drogi**. Dla 400 m to 20 m.

### H12–H20 · Tor A: łączność (B + D)

- [ ] M1: ciągły bufor trasy w aplikacji, niezależny od trybu.
- [ ] M2: ekran „Wyślij pozycję” — stan (ok / potrzebuję pomocy / SOS), bateria, podgląd treści SMS-a i licznik znaków.
- [ ] M3: strona odbiorcza w `apps/ops` — wklejasz treść, dostajesz trasę na mapie, czas fixa, baterię, wysokość.

> **BRAMKA H20:** telefon generuje treść, człowiek przenosi ją ręcznie na laptop,
> trasa rysuje się poprawnie. **To już jest kompletne demo toru A** — wszystko
> dalej jest ulepszaniem.

### H20–H30 · Przełączanie trybów i drugi spacer (wszyscy)

- [ ] M6: automatyczne przejście budynek ↔ teren. Reguła: jakość fixa GNSS + flaga `clean` z `magFeature()` (pole ziemskie = jesteś na zewnątrz).
- [ ] **Drugi spacer**: start w korytarzu, wyjście na zewnątrz, pętla wokół budynku, powrót. Jedno nagranie, oba tryby.
- [ ] Metryki dla obu odcinków osobno.

> **BRAMKA H30:** jedno nagranie, dwa tryby, ciągły ślad przez drzwi wejściowe.
> To jest obrazek, który sprzedaje dual-use.

### H30–H38 · SHOULD i zapas (A + B)

- [ ] S1 (DEM), S2 (burst), S3 (detektor spoofingu) — w tej kolejności.
- [ ] Każda pozycja, która nie działa o **H36**, wypada z dema.
- [ ] Aktualizacja strony wyników: `npm run report` z prawdziwymi danymi terenowymi.

### H38–H48 · Zamrożenie, próby, pitch (wszyscy)

> **H38: ZAMROŻENIE KODU.** Tylko poprawki awarii. Reguła nienegocjowalna.

- [ ] Trzy pełne próby dema na docelowej trasie przed budynkiem, z zegarkiem.
- [ ] Nagrania zapasowe w aplikacji + film z udanego przejścia.
- [ ] Pitch 5 minut, przećwiczony.

---

## 7. Scenariusz dema — przed budynkiem

Pięć minut, cztery sceny. Każda ma jedną liczbę na ekranie.

**Scena 1 · Budynek (60 s).** Operator przechodzi pętlę korytarzem. Na rzutniku ślad
i dwie linie: pomarańczowa (samo zliczanie kroków) ucieka, niebieska trzyma się
korytarza. Wraca do punktu startu. **Liczba: błąd zamknięcia pętli w metrach.**

**Scena 2 · Drzwi (20 s).** Operator wychodzi na zewnątrz. Aplikacja sama przełącza
tryb — na górnym pasku „TEREN / GNSS ✓”. **Nie ma przerwy w śladzie.** To jest moment,
w którym jury rozumie, że to jeden system, a nie dwa demo sklejone taśmą.

**Scena 3 · Utrata zasięgu (90 s).** Tryb samolotowy. Znika GNSS, znika sieć. Operator
obchodzi budynek. Ślad rysuje się dalej, trzymany przez inercję i graf ścieżek.
**Liczba: rozmiar elipsy niepewności, rosnący i uczciwy.**

**Scena 4 · Okno transmisji (60 s).** Operator wyłącza tryb samolotowy na dwie sekundy
i włącza z powrotem. W tym oknie leci pakiet. Na laptopie ratownika pojawia się
**cała trasa od początku dema**. Na ekranie telefonu widać treść wiadomości.
**Liczba: 157 znaków ze 160.**

Zamknięcie, jedno zdanie: *ten telefon nie miał zasięgu przez trzy minuty i nikt nie
wiedział, gdzie jest. Dwie sekundy sieci wystarczyły, żeby przekazać cały przebyty
dystans — i to jest dokładnie sytuacja turysty w Tatrach i żołnierza w strefie
zagłuszania.*

### Zabezpieczenia sceny

- Trasa przemierzona i nagrana **wcześniej tego samego dnia** — replay z etykietą „REPLAY” jako plan B.
- Drugi telefon z tym samym buildem i tymi samymi mapami.
- Panel operatora (`apps/ops`) z przyciskami scenariuszy — zero wpisywania komend na scenie.
- `scrcpy` przez USB, przetestowany na docelowym projektorze przed H38.

---

## 8. Kryteria akceptacji

| Co | Próg | Skąd |
|---|---|---|
| Błąd zamknięcia pętli w budynku | < 3% drogi | `npm run replay` |
| Błąd na odcinku terenowym bez GNSS | < 5% drogi | to samo nagranie |
| Ciągłość śladu przez drzwi | brak przerwy > 5 s | inspekcja wzrokowa wykresu |
| Trasa 400 m w pakiecie | < 10 m błędu odtworzenia | `npm test` |
| Pakiet w jednym SMS-ie | ≤ 160 znaków | `npm test` |
| Uczciwość niepewności | pokrycie 1σ w przedziale 30–60% | `npm run bench` |
| Cały cykl w aplikacji | START → spacer → wyślij → STOP bez restartu | próba |

---

## 9. Ryzyka specyficzne dla nowego zakresu

| Ryzyko | Reakcja |
|---|---|
| Brak szlaków w OSM wokół miejsca hakatonu | Narysować graf ręcznie przez `tools/make_venue.ts` — działa tak samo w terenie |
| Barometr nieobecny w telefonie testowym | S1 wypada, tor B stoi na GNSS + PDR + graf; sprawdzić w H0 |
| Teren przed budynkiem jest płaski | DEM nic nie wnosi — nie wymuszać, zamiast tego mocniej pokazać tor A |
| Android ubija aplikację w tle | Foreground service albo demo z ekranem włączonym; zdecydować w H12, nie w H40 |
| GNSS nie zdąży złapać fixa na starcie | Rozgrzać odbiornik 2 min przed demem, na zewnątrz |
| Wysyłka SMS wymaga potwierdzenia użytkownika | Tak ma być — mówimy to wprost (rozdział 4) |
| Zbyt szeroki zakres, nic nie dowiezione | Linie cięcia z rozdziału 3 i twarde bramki |

---

## 10. Co zmienić w istniejących dokumentach

- `docs/01-PLAN-IMPLEMENTACJI.md` — harmonogram nieaktualny, zastąpiony tym plikiem. Reszta (metryki, zasady) obowiązuje.
- `docs/04-DEMO-I-PITCH.md` — scenariusz do wymiany na rozdział 7 stąd.
- `docs/03-FORMATY-DANYCH.md` — dopisać format pakietu beacona (§ w `track.ts`).
- `README.md` — teza produktu do aktualizacji.
- Nazwa `ariadna` w `package.json` i w dokumentacji — do ujednolicenia z Crisis-Sentinel.
