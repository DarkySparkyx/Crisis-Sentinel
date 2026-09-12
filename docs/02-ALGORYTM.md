# Algorytm — specyfikacja

Dokument opisuje, co dokładnie liczy `packages/core`. Każda sekcja wskazuje plik.

---

## 1. Układy odniesienia i konwencje

To jest miejsce, w którym gubi się najwięcej czasu na hakatonie. Ustalone raz, na sztywno:

- **Rama nawigacyjna (ENU):** `x` = Wschód, `y` = Północ, `z` = Góra. Jednostki: metry.
- **Rama urządzenia (Android):** `x` = w prawo od ekranu, `y` = ku górze ekranu,
  `z` = od ekranu do użytkownika.
- **Kurs (heading):** kierunek, w którym wskazuje oś **+Y urządzenia**, liczony od Północy
  **zgodnie z ruchem wskazówek zegara**. Dokładnie ta sama konwencja co azimuth
  z `SensorManager.getOrientation()`.
- **Przemieszczenie na krok:** `Δx = L·sin(kurs)`, `Δy = L·cos(kurs)`. (Sinus przy Wschodzie
  — częsty błąd to odwrotnie.)
- **Czas:** jedna monotoniczna oś w **milisekundach** od startu sesji. Nie epoch, nie
  nanosekundy od bootu, nie czas ścienny.

Jednostki na wejściu: akcelerometr **m/s²** (Expo zwraca g — trzeba przemnożyć przez 9,80665),
żyroskop **rad/s**, magnetometr **µT**, barometr **hPa**.

---

## 2. Orientacja — `attitude.ts`

Filtr komplementarny na kwaternionie, **bez magnetometru**.

```
predykcja:   q ← q ⊗ exp(½·(ω − b)·Δt)
korekta:     e = (q ⊗ â_dev) × (0,0,1)          # gdzie filtr sądzi, że jest pion, vs gdzie jest
             q ← exp(½·k·e) ⊗ q
```

Trzy szczegóły, które decydują o jakości:

**Zaufanie do akcelerometru.** Podczas marszu akcelerometr mierzy grawitację *plus*
przyspieszenie ciała. Korygowanie pionu w takim momencie psuje orientację. Waga korekty
jest więc skalowana przez `exp(−(|‖a‖ − g|/1,5)²)` — im dalej od 9,81, tym mniej ufamy.

**ZARU — estymacja biasu żyroskopu.** W bezruchu odczyt żyroskopu **to sam bias**.
Warunek bezruchu: wygładzona wariancja `|‖a‖ − g| < 0,35` oraz `‖ω‖ < 0,12`.
Bias uśredniany wykładniczo z wzmocnieniem 0,01.

> Dlaczego to jest najważniejsza linijka w projekcie: bias 0,008 rad/s to **27° dryfu
> kursu na minutę**. Na pętli 96 m bez ZARU błąd zamknięcia wynosi 13,6 m, z ZARU — 0,5 m.

**Kurs jest względny.** Na starcie `heading = 0` oznacza „kierunek, w którym stałem
przy inicjalizacji”, nie Północ. Wyrównanie do Północy: `alignHeading()` z fixa GNSS
sprzed wejścia, z kompasu na otwartej przestrzeni, albo ze wskazania na mapie.

---

## 3. Kroki i długość kroku — `steps.ts`

**Detekcja.** Przyspieszenie rzutowane na bieżący wektor grawitacji (nie na oś Z!),
odjęte `g`, przepuszczone przez pasmo 0,5–3 Hz (kadencja marszu to 1,5–2,5 Hz).
Krok = pik powyżej progu adaptacyjnego, przy zachowaniu minimum 250 ms od poprzedniego.
Próg adaptacyjny to 25% średniej z ostatnich 20 amplitud — dzięki temu detektor działa
i przy spokojnym chodzie, i przy biegu.

**Długość kroku — model Weinberga:**

```
L = K · (a_max − a_min)^(1/4)
```

Zakres ograniczony do [0,30; 1,10] m. Współczynnik `K` różni się między ludźmi o ±25%,
więc jest kalibrowany: przejdź zmierzony odcinek ≥ 20 m, wywołaj `calibrateK(dystans, amplitudy)`.
Bez kalibracji `K = 0,47` — rozsądny start dla dorosłego.

Filtr cząsteczkowy dodatkowo estymuje mnożnik `k` per cząstka, więc systematyczny błąd
kalibracji jest douczany w trakcie marszu.

---

## 4. Cecha magnetyczna — `magfeat.ts`

Surowe `(x, y, z)` z magnetometru są **bezużyteczne jako odcisk palca miejsca**, bo zmieniają
się przy każdym obrocie telefonu w ręce. Potrzebne są wielkości niezmiennicze.

Po obrocie do ramy nawigacyjnej wyliczamy trójkę:

| Cecha | Definicja | Niezmiennicza względem |
|---|---|---|
| `f` | `‖B‖` | dowolnego obrotu |
| `z` | składowa pionowa (w górę) | obrotu wokół pionu |
| `h` | `√(B_E² + B_N²)` | obrotu wokół pionu |

Obrót wokół pionu to dokładnie to, co robi użytkownik, obracając się z telefonem — więc
te trzy liczby opisują *miejsce*, a nie *pozę telefonu*. Trzy wymiary zamiast jednego (`‖B‖`)
dają istotnie lepsze rozróżnianie miejsc.

**Flaga `clean`** oznacza pole zbliżone do ziemskiego (dla Polski: `‖B‖ ≈ 49,5 µT ± 4`,
inklinacja `≈ 67° ± 8`). Tylko przy `clean = true` wolno użyć magnetometru jako kompasu.

**Kalibracja hard-iron** (`fitHardIron`): dopasowanie środka sfery metodą najmniejszych
kwadratów do chmury punktów zebranej przy obracaniu telefonem („ósemka”, ~15 s).
Bez tego każdy egzemplarz telefonu (i każde etui z magnesem) ma własny stały offset,
przez co mapa z jednego telefonu nie pasuje do drugiego.

---

## 5. Mapa magnetyczna — `magmap.ts`

Siatka 1 × 1 m w lokalnym ENU. Każda komórka trzyma statystyki online (Welford)
trzech cech: średnią i odchylenie standardowe.

**Model obserwacji** (log-wiarygodność, suma po trzech cechach):

```
log p(z | x) = Σ  max( −6 ,  −½ · ((z_i − µ_i) / max(σ_i, 2 µT))² )
```

Dwie decyzje, które wyglądają na drobiazgi, a decydują o tym, czy filtr w ogóle działa:

**(a) Podłoga na sigma (2 µT).** Komórka z trzema niemal identycznymi próbkami miałaby
σ ≈ 0, co dałoby nieskończoną pewność i natychmiast zabiło wszystkie cząstki poza jedną.

**(b) Kara za miejsce nieznane: `−1,5`, nie `0`.**

> To jest pułapka, na którą łatwo się nadziać i trudno ją zdiagnozować. Gdyby nieznanemu
> miejscu przypisać log-wiarygodność 0, to znaczy wiarygodność **1** — czyli *więcej* niż
> idealne dopasowanie (które przy trzech cechach daje około `exp(−1,5)`). Filtr zacząłby
> wtedy aktywnie uciekać poza obszar mapy, bo tam „pasuje lepiej”. Wartość −1,5 to
> `E[−½d²]` dla trzech wymiarów przy poprawnym modelu: *nieznane jest tak samo dobre jak
> przeciętne trafienie, ale nie lepsze*.
>
> W naszych testach ten jeden znak decydował o różnicy między RMSE 13 m a RMSE 1,4 m.

**(c) Fallback do sąsiadów.** Jeśli trafiona komórka jest pusta, szukamy najbliższej
zapełnionej w promieniu 1 komórki. Rozszerza to efektywną szerokość zmapowanego korytarza
z 1 m do ~3 m i zapobiega „głodzeniu” filtru tuż obok przejścia kalibracyjnego.

---

## 6. Mapa budynku — `graph.ts`, `geojson.ts`

Dwie warstwy z jednego GeoJSON-a:

- **Ściany** — twarde ograniczenie. Cząstka, której odcinek ruchu przeciął ścianę,
  dostaje wagę 0. Indeks przestrzenny (siatka 5 m) sprowadza koszt z `O(cząstki × ściany)`
  do praktycznie stałego.
- **Ścieżki chodzenia** — miękka kara `−0,15 · d²` za odległość od osi korytarza.

To najtańszy duży zysk dokładności w całym systemie: eliminuje dryf boczny bez żadnej
infrastruktury i bez żadnego surveyu. W pomiarach sama mapa budynku poprawia błąd
zamknięcia z 14,2% do 0,7%.

Rozpoznawanie typów: `properties.kind` = `wall` | `walkable` | `haven` | `anchor`.
Dla danych prosto z OSM działa heurystyka na tagach (`building`, `highway=footway`, …).

---

## 7. Filtr cząsteczkowy — `pf.ts`

**Stan cząstki:** `(x, y, θ, k, b_ω)` — pozycja, kurs, mnożnik długości kroku,
systematyczny bias skrętu.

Ostatnie dwie składowe są tym, co pozwala filtrowi **uczyć się użytkownika i telefonu
w trakcie marszu**: `k` dostraja kalibrację kroku, `b_ω` wyłapuje resztkowy dryf żyroskopu,
którego nie usunął ZARU.

**Krok filtru wykonuje się na zdarzenie kroku (~2 Hz), nie na próbkę czujnika (100 Hz).**
To jest powód, dla którego 1000 cząstek liczy się w czystym JavaScripcie na telefonie
bez zacinania UI. Zmierzone: 138 kroków × 1000 cząstek ≈ 150 ms w Node.

```
propagacja:  b_ω ← b_ω + N(0, σ_b)
             θ   ← θ + Δψ + b_ω + N(0, σ_θ)
             k   ← clip(k + N(0, σ_k), 0,5 … 1,6)
             L   = L̂ · k · (1 + N(0, σ_L))
             (x, y) ← (x + L·sin θ,  y + L·cos θ)

waga:        0                        jeśli odcinek przeciął ścianę
             w · p(mag) · p(korytarz) w przeciwnym razie

resampling:  systematyczny, gdy N_eff < N/2
```

Zwracana jest **średnia ważona + kowariancja**, z której liczymy promień 1σ
(pierwiastek większej wartości własnej). To jest liczba, którą pokazujemy użytkownikowi.

### Roughening — i historia jednej awarii

Po resamplingu cząstki się duplikują i różnorodność chmury spada. Klasyczna awaria wygląda
tak: filtr działa poprawnie przy `N = 400`, poprawnie przy `N = 1500`, a przy `N = 800`
nagle ucieka o 30 m i nie wraca. Wygląda jak błąd losowy, jest deterministyczną zapaścią
różnorodności.

Lekarstwo (Gordon 1993): po resamplingu dodaj szum skalowany rozrzutem chmury i liczbą cząstek:

```
σ_j = K · (max_j − min_j) · N^(−1/d),   d = 4,  K = 0,08
```

Dobór `K` ma wąskie okno, co warto znać: `K = 0` → sporadyczne ucieczki,
`K = 0,05…0,1` → stabilnie, `K = 0,5` → chmura eksploduje (raportowana niepewność
rośnie do 50–70 m). Wartość 0,08 zweryfikowana na 8 niezależnych przebiegach
× 3 liczby cząstek.

### Parametry domyślne

| Parametr | Wartość | Uwagi |
|---|---|---|
| `n` | 800–1500 | poniżej 300 rośnie ryzyko zapaści, powyżej 3000 bez zysku |
| `sigmaTurn` | 0,035 rad/krok | ≈ 2° — odpowiada realnemu szumowi kursu |
| `sigmaLen` | 0,10 | 10% zmienności długości kroku |
| `sigmaK` | 0,004 | powolna adaptacja do sylwetki |
| `sigmaBw` | 0,002 rad/krok | powolna adaptacja do dryfu |
| `magWeight` | 1,0 | podnieść, gdy mapa jest gęsta i pewna |
| `walkablePull` | 0,15 | 0 wyłącza przyciąganie do osi korytarza |
| `roughening` | 0,08 | patrz wyżej |

Strojenie: `npm run sweep -- data/recordings/<nagranie>.jsonl`.

---

## 8. Czego jeszcze nie ma (kolejność wdrażania, jeśli zostanie czas)

1. **Domknięcie pętli (loop closure)** — dopasowanie sekwencji ostatnich N kroków (DTW
   na `‖B‖`) do wcześniej odwiedzonego fragmentu i wstrzyknięcie tam cząstek. To zamienia
   system w prawdziwy magnetyczny SLAM.
2. **Piętra** — barometr → detekcja zmiany poziomu → osobna mapa na piętro.
3. **Estymacja misalignmentu** — PCA na poziomej składowej przyspieszenia daje kierunek
   marszu niezależnie od tego, jak trzymany jest telefon (kieszeń, bok).
4. **Lokalizacja globalna** — `initGlobal()` istnieje, brakuje kryterium zbieżności
   i sygnalizacji w UI.
5. **Detektor spoofingu GNSS** — trzy warunki: skok pozycji > `v_max·Δt`, rozjazd
   z trajektorią PDR > próg, C/N0 < próg.
