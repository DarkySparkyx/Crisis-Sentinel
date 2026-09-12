# Ariadna — nawigacja magnetyczno-inercyjna bez GNSS

Telefon z Androidem, w trybie samolotowym, wie gdzie jest — bo czyta anomalie magnetyczne
budynku jak odcisk palca, zlicza kroki i wie, gdzie są ściany.

```
                          RMSE      CEP50     błąd zamknięcia pętli 96 m
  sam krokomierz (PDR)    5,08 m    3,75 m    13,35 m   (13,9% drogi)
  + geometria budynku     1,63 m    1,11 m     1,03 m   ( 1,1%)
  + mapa magnetyczna      0,60 m    0,57 m     0,35 m   ( 0,4%)
  + obie                  0,57 m    0,45 m     0,51 m   ( 0,5%)
```
*Dane syntetyczne, bias żyroskopu 0,008 rad/s. Mapa magnetyczna z jednego przejścia
kalibracyjnego, ocena na pięciu **innych** przejściach — `npm run bench` odtwarza tabelę.*

## Start w 60 sekund

**Wymagany Node >= 22.6** — projekt uruchamia pliki `.ts` bezpośrednio, bez kroku
budowania. Na starszym Node zobaczysz `Unknown file extension ".ts"`.

```bash
node --version    # musi być >= 22.6; jeśli nie: nvm install 22 && nvm use 22
npm run doctor    # sprawdza środowisko i mówi, co jest nie tak

npm test          # 21 testów rdzenia algorytmu
npm run bench     # tabela powyżej, z uczciwym podziałem kalibracja/ocena
npm run demo      # pełny cykl: mapa -> przejście kalibracyjne -> ocena -> data/out/demo.svg
```

Żadnego `npm install` nie trzeba — rdzeń nie ma zależności. (`npm install`
w korzeniu i tak działa, linkuje tylko workspace'y.)

`npm run demo` robi dokładnie to (każdy krok osobno, gdybyś chciał podmienić dane):

```bash
node tools/make_venue.ts   --out data/maps/synthetic.geojson       # mapa obiektu
node packages/replay/src/cli.ts synth  --seed 7  --out data/recordings/kalibracja.jsonl
node packages/replay/src/cli.ts survey data/recordings/kalibracja.jsonl --out data/magmaps/demo.json
node packages/replay/src/cli.ts synth  --seed 23 --out data/recordings/ocena.jsonl
node packages/replay/src/cli.ts run    data/recordings/ocena.jsonl \
      --venue data/maps/synthetic.geojson --magmap data/magmaps/demo.json --svg data/out/demo.svg
```

### Strona z wynikami

`docs/report.html` to samodzielna strona z wykresami — otwiera się z dysku, bez serwera.
Powstaje z szablonu i świeżo policzonych danych:

```bash
npm run report            # metryki -> data/out/report-data.json -> docs/report.html
xdg-open docs/report.html
```

| Plik | Rola |
|---|---|
| `tools/export_report_data.ts` | liczy wszystkie metryki (ablacja, CDF, kalibracja, sweepy) do JSON-a |
| `docs/report.template.html` | układ, style i kod wykresów; dane wchodzą w placeholder `__DATA__` |
| `tools/build_report.ts` | wstrzykuje JSON w szablon |
| `docs/report.html` | wynik — **nie edytuj ręcznie**, jest nadpisywany |

Po zebraniu prawdziwych przejść po korytarzu podmień `generate()` na wczytywanie nagrań
`.jsonl` w `tools/export_report_data.ts` i uruchom `npm run report` — wykresy zostają,
zmieniają się tylko liczby.

### Strojenie parametrów filtru

Siatka `sigmaTurn` × `sigmaLen` × `magWeight`:

```bash
node packages/replay/src/cli.ts sweep data/recordings/ocena.jsonl \
      --venue data/maps/synthetic.geojson --magmap data/magmaps/demo.json
```

Bez argumentów `cli.ts` wypisuje pełną pomoc.

Aplikacja:

```bash
cd apps/mobile && npm install && npx expo start     # Expo Go, bez buildów natywnych
```

Serwer pomocniczy (opcjonalny — nawigacja działa bez niego):

```bash
cd apps/ops && pip install -r requirements.txt && uvicorn main:app --host 0.0.0.0 --port 8000
```

## Struktura

```
packages/core/      rdzeń algorytmu — czysty TypeScript, ZERO zależności
                    ten sam kod działa w Node i w React Native
  attitude.ts       orientacja (komplementarny + ZARU), bez magnetometru
  steps.ts          detekcja kroku + długość (Weinberg)
  magfeat.ts        cecha magnetyczna niezmiennicza na obrót telefonu
  magmap.ts         mapa anomalii, siatka 1 m, statystyki Welforda
  graph.ts          ściany i korytarze z indeksem przestrzennym
  pf.ts             filtr cząsteczkowy (x, y, kurs, skala kroku, bias skrętu)
  pipeline.ts       spina wszystko: próbki -> fixy

packages/replay/    narzędzie zespołu: synth | run | survey | sweep
                    generator syntetycznych spacerów z ground truth co do centymetra

apps/mobile/        Expo (Expo Go, bez prebuild), react-native-svg
apps/ops/           FastAPI: nagrania, mapy, panel operatora demo
tools/              make_venue.ts (korytarz z pomiaru), osm_fetch.py (OSM)
docs/               analiza, plan, algorytm, formaty, demo
```

## Dokumentacja

| Plik | Zawartość |
|---|---|
| [`docs/00-ANALIZA-PLANU.md`](docs/00-ANALIZA-PLANU.md) | krytyka pierwotnego planu: 31 wad + naprawy |
| [`docs/01-PLAN-IMPLEMENTACJI.md`](docs/01-PLAN-IMPLEMENTACJI.md) | 48 h, role, harmonogram z bramkami, metryki, ryzyka |
| [`docs/02-ALGORYTM.md`](docs/02-ALGORYTM.md) | specyfikacja: wzory, parametry, pułapki |
| [`docs/03-FORMATY-DANYCH.md`](docs/03-FORMATY-DANYCH.md) | JSONL, GeoJSON, mapa magnetyczna, API |
| [`docs/04-DEMO-I-PITCH.md`](docs/04-DEMO-I-PITCH.md) | scenariusz, przebieg 5 min, checklisty, odpowiedzi na pytania |

## Trzy decyzje, które definiują ten projekt

1. **Magnetometr NIE jest kompasem.** Wewnątrz budynków pole jest zniekształcone o 20–90°.
   To zniekształcenie jest naszym sygnałem lokalizacyjnym — i dlatego kurs bierzemy
   z żyroskopu, a nie z magnetometru.
2. **Jeden rdzeń algorytmu, dwa środowiska.** `packages/core` to czysty TypeScript bez
   zależności. Uruchamia go Node 22 natywnie i Metro w React Native. Nie ma dwóch
   rozjeżdżających się implementacji.
3. **Narzędzia do strojenia powstają przed algorytmem.** Generator syntetyczny i replay
   są gotowe w pierwszych godzinach. Iteracja algorytmu trwa sekundy, nie spacer po budynku.

## Instalacja Node (jeśli masz starszego niż 22.6)

Ubuntu 24.04 domyślnie ma Node 18, który **nie uruchomi tego projektu** — pliki `.ts`
działają bez kroku budowania dopiero od Node 22.6. Sprawdź: `node --version`.

### Wariant A — nvm (zalecany: bez sudo, nie rusza systemowego Node)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
exec $SHELL                 # albo: source ~/.bashrc
nvm install --lts           # aktualny LTS
nvm alias default lts/*     # żeby nowe terminale też go miały
node --version              # sprawdzenie
```

Każdy członek zespołu robi to u siebie. Potem w katalogu projektu: `npm run doctor`.

> Jeśli coś się zachowa dziwnie na najnowszym LTS, `nvm install 22 && nvm use 22`
> daje wersję, na której projekt był testowany.

### Wariant B — apt przez NodeSource (systemowo, wymaga sudo)

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
```

Zastępuje systemowego Node 18. Jeśli coś innego na komputerze na nim polega — użyj nvm.

### Wariant C — bez instalacji (awaryjnie)

Pobierz binarkę i rozpakuj do katalogu domowego:

```bash
cd ~ && curl -fsSL https://nodejs.org/dist/latest-lts/ | grep -o 'node-v[0-9.]*-linux-x64.tar.xz' | head -1
# podstaw znalezioną nazwę pliku:
curl -fsSL https://nodejs.org/dist/latest-lts/NAZWA.tar.xz | tar -xJ
export PATH="$HOME/NAZWA/bin:$PATH"
```

## Rozwiązywanie problemów

`npm run doctor` diagnozuje środowisko i mówi, czego brakuje.

| Objaw | Przyczyna | Rozwiązanie |
|---|---|---|
| `Unknown file extension ".ts"` | Node < 22.6 | patrz sekcja wyżej |
| `ZA STARY NODE` przy `npm test` | Node < 22.6 | patrz sekcja wyżej |
| `nvm: command not found` po instalacji | shell nie przeładował konfiguracji | `exec $SHELL` albo nowy terminal |
| `ExperimentalWarning: Type Stripping` | Node 22.6–22.17 | działa poprawnie, ostrzeżenie jest wyciszane przez `scripts/run.mjs` |
| `BŁĄD: nie znaleziono pliku nagrania` | brak danych wejściowych | `npm run synth` |
| kolumna `magW` w `sweep` nic nie zmienia | brak `--magmap` | `npm run survey -- <nagranie> --out data/magmaps/x.json` |
| `npm run sweep` bez wyjścia | `head` zamyka potok (SIGPIPE) | `... \| tail -20` albo bez potoku |

Wymagania: Node ≥ 22.6 (natywne uruchamianie `.ts`), Python ≥ 3.10 dla serwera `apps/ops`.
