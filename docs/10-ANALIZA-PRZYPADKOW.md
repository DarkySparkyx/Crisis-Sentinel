# Analiza przypadków użycia — dual use

Dokument sprawdza, przypadek po przypadku, **co naprawdę zawodzi** w każdej sytuacji:
pozycja, łączność, czy jedno i drugie. Bez tego rozdzielenia łatwo zbudować rozwiązanie
problemu, którego nie ma.

---

## 0. Ustalenie, które przewraca pierwotną tezę

**W lesie GPS działa.** Pomiary na iPhonie 12 Pro pod gęstym okapem drzew liściastych:
RMSE **3,91 m** (zakres 3,04–5,64 m). Odbiornik mapowy Trimble: 3,45 m. Turystyczny
Garmin: 8,11 m.

Cztery metry to dokładność, która wystarcza, żeby trafić na szlak szerokości metra.
**Zabłądzony turysta w lesie nie ma problemu z wiedzą, gdzie jest.** Ma problem z tym,
że nikt inny nie może się tego dowiedzieć.

I tu polskie realia są zaskakująco puste:

| Kanał | Stan w Polsce (wrzesień 2026) |
|---|---|
| Emergency SOS przez satelitę (Apple) | **Niedostępny.** W lipcu 2026 dołączyły Andora i Islandia; Polski nadal nie ma. Apple uzależnia wdrożenie od uruchomienia „text to 112”. |
| SMS na 112 dla ogółu | **Nie istnieje.** W maju 2025 Ministerstwo Cyfryzacji dopiero powołało zespół roboczy. Osobny numer SMS działa wyłącznie dla osób niesłyszących, po rejestracji. |
| Aplikacja RATUNEK (GOPR/TOPR) | **Wymaga zasięgu sieci.** Autorzy piszą wprost, że bez sieci aplikacja nie działa i nie zastąpi beacona. |
| PLB / Garmin inReach | Działa, ale to osobne urządzenie za 1000–2500 zł, którego turysta jednodniowy nie ma. |

Wniosek: **turysta bez zasięgu w polskich górach nie ma dziś żadnej drogi przekazania
swojej pozycji.** To jest dziura, którą warto zaadresować — i którą da się zaadresować
oprogramowaniem, bez nowego sprzętu.

Skala problemu: TOPR w 2025 r. przeprowadził **1098 wypraw ratunkowych**, uratował
**1256 osób**, odnotował **16 wypadków śmiertelnych**.

---

## 1. Przypadki cywilne

Legenda: ✔ działa · ◐ zdegradowane · ✘ nie działa

| # | Sytuacja | GNSS | Łączność | Realny problem | Co wnosimy |
|---|---|---|---|---|---|
| C1 | Zabłądzenie w lesie / niskich górach | ✔ 4 m | ✘ | Nikt nie wie, gdzie jesteś | Ślad w 1 SMS-ie + wysyłka oportunistyczna |
| C2 | Uraz, unieruchomienie, bateria na wyczerpaniu | ✔ | ✘ | Czas. Każda minuta to rosnący obszar poszukiwań | Pakiet 120 B wysyłany przy każdym oknie zasięgu, tryb niskiego poboru |
| C3 | Wąwóz, kocioł, ściana skalna | ◐ 10–30 m | ✘ | Pozycja skacze, ślad rwie się | PDR + graf szlaków wypełnia luki między fixami |
| C4 | Jaskinia, sztolnia, tunel | ✘ | ✘ | Pozycja od wejścia w dół — zero | Nawigacja inercyjna + barometr (piętra/głębokość) |
| C5 | Strażak w zadymionym budynku | ✘ | ◐ | Pozycja wewnątrz konstrukcji | Tryb magnetyczny (istniejący), 0,5 m na pętli 96 m |
| C6 | Parking podziemny, metro | ✘ | ◐ | Ciągłość pozycji przy wejściu/wyjściu | Płynne przejście GNSS ↔ inercja |
| C7 | Lawina, akcja czasowo krytyczna | ✔/✘ | ✘ | Obszar poszukiwań rośnie kwadratowo z czasem | Ostatni ślad zawęża obszar z masywu do odcinka szlaku |
| C8 | Grupa turystów, jedna osoba odłączona | ✔ | ✘ | Reszta grupy nie wie, gdzie jej szukać | Przekaźnik BLE — pozycja przeskakuje przez telefony grupy |

### Gdzie leży wartość, a gdzie jej nie ma

**C1, C2, C7 — tu jesteśmy naprawdę potrzebni.** Problemem jest wyłącznie transmisja.
Rozwiązanie: skompresować to, co trzeba przekazać, do rozmiaru, który przejdzie
w najgorszym możliwym kanale, i wysyłać to automatycznie przy każdej okazji.

**C3, C4, C5, C6 — tu potrzebna jest ciągłość pozycji.** To dokładnie to, co obecny
silnik już robi w budynku; w terenie zmienia się obserwacja, nie algorytm.

**C8 — to bonus.** Przekaźnik BLE jest efektowny, ale zasięg 50–100 m oznacza, że
działa tylko dla grupy idącej razem. Nie jest to rozwiązanie problemu; to poszerzenie
okna transmisji.

---

## 2. Przypadki wojskowe

Wątek obronny nie jest doklejony na siłę: opiera się na tych samych trzech własnościach
(ciągła pozycja bez infrastruktury, mały pakiet, transmisja przy pierwszej okazji),
tyle że w środowisku, w którym zawodzi **pozycja**, a nie łączność.

**Skala jest realna.** Raport Politechniki Gdańskiej i MON z lipca 2026: **ponad dwie
trzecie terytorium Polski** znajduje się w zasięgu aktywnych zakłóceń sygnałów GNSS.
Wskazane źródła: obwód kaliningradzki, „flota cieni” na Bałtyku, prawdopodobnie
również satelita wojskowy.

| # | Sytuacja | GNSS | Łączność | Realny problem | Co wnosimy |
|---|---|---|---|---|---|
| M1 | Działanie w strefie zagłuszania GNSS | ✘ | ◐ | Nawigacja pieszo bez odniesienia | Inercja + mapa terenu, ta sama co w trybie turystycznym |
| M2 | Spoofing — GNSS podaje fałszywą pozycję | ✘ (gorzej: kłamie) | ◐ | **Zaufanie do odczytu.** Fałszywa pewność jest groźniejsza niż jej brak | Detektor niespójności: skok pozycji > v_max·Δt, rozjazd z PDR, spadek C/N0 |
| M3 | Podziemia, tunel, budynek | ✘ | ✘ | Pozycja i łączność naraz | Tryb magnetyczny + bufor śladu do późniejszej transmisji |
| M4 | Cisza radiowa / minimalna emisja | — | celowo ✘ | Każda transmisja to sygnatura | Pakiet 120 B = jedna krótka emisja zamiast ciągłego strumienia |
| M5 | Odzyskiwanie personelu (CSAR) | ✘/◐ | ✘ | Gdzie jest osoba i którędy szła | Ten sam pakiet 120 B — bez zmian w formacie |

### Uwaga o granicy zastosowania

To jest system **nawigacji i lokalizacji własnej**. Nie celuje, nie naprowadza,
nie jest elementem żadnego systemu uzbrojenia. Dual use oznacza tu: ten sam telefon
i ten sam kod pomagają zabłądzonemu turyście i żołnierzowi w strefie zagłuszania,
bo obaj mają ten sam problem — utracone odniesienie i brak drogi powrotu informacji.

---

## 3. Zweryfikowany fundament: ślad w jednym SMS-ie

To nie jest deklaracja — to zmierzona właściwość zaimplementowanego kodeka
(`packages/core/src/track.ts`, 11 testów w `packages/core/test/track.test.ts`).

**Budżet.** SMS w alfabecie GSM-7 to 160 znaków. Używamy 64-znakowego podzbioru
(A–Z a–z 0–9 . -) po 6 bitów na znak: **160 × 6 = 960 bitów = 120 bajtów ładunku.**

**Co się w to mieści** (trasa górska z serpentynami, pomiar na syntetycznym szlaku):

| Długość trasy | Punkty po uproszczeniu | Błąd średni | p95 | maks. |
|---|---|---|---|---|
| 5 km | 57 | 6,7 m | 15,3 m | 21,6 m |
| 12 km | 39 | 6,9 m | 17,7 m | 23,2 m |
| **20 km** | **52** | **16,4 m** | **41,8 m** | **56,7 m** |
| 40 km | 31 | 28,6 m | 69,6 m | 99,1 m |

Czyli: **cały dzień w górach — 20 km — mieści się w jednej wiadomości SMS, z trasą
odtworzoną z dokładnością 16 m średnio i 42 m w 95. percentylu.** Dla planowania
poszukiwań to różnica między „gdzieś w masywie” a „na tym odcinku szlaku”.

**Odporność na obcięcie.** Pakiet jest ułożony tak, że pozycja bieżąca idzie pierwsza,
a trasa wstecz od teraz. Nawet **15% pakietu** wystarcza, żeby odtworzyć bieżącą
pozycję z błędem 0,3 m. Reszta to coraz dłuższa historia.

**Degradacja przy mniejszym budżecie** (trasa 12 km):

| Kanał | Budżet | Błąd średni | p95 |
|---|---|---|---|
| Sam ping pozycyjny | 20 B | 108,6 m | 446,8 m |
| Pół SMS-a | 60 B | 18,9 m | 45,1 m |
| **Jeden SMS** | **120 B** | **6,9 m** | **17,7 m** |
| Pakiet BLE | 480 B | 3,4 m | 8,2 m |

---

## 4. Czego ten system NIE rozwiązuje

Warto mieć to przygotowane, zanim zapyta jury.

- **Nie zastąpi PLB ani inReacha.** Nadajnik satelitarny działa tam, gdzie nie ma
  żadnej sieci komórkowej. My potrzebujemy okna — choćby dwusekundowego. Nasza
  przewaga to nie zasięg, tylko to, że **turysta już ma ten telefon w kieszeni**.
- **Nie stworzymy łączności tam, gdzie jej nie ma.** Jeśli przez całą dobę nie będzie
  ani jednego okna zasięgu ani jednego telefonu w pobliżu, pakiet nie wyjdzie.
  Zostaje wtedy jako czarna skrzynka — odczytywana po odnalezieniu, co i tak jest
  wartością dla rekonstrukcji zdarzenia.
- **Nie wykryjemy upadku lepiej niż zegarek.** Detekcja bezruchu jest prosta, ale to
  nie jest nasza przewaga i nie należy jej sprzedawać jako takiej.
- **Nie zadziała bez baterii.** Tryb niskiego poboru (rzadszy GNSS, sama inercja)
  wydłuża czas pracy, ale go nie usuwa jako ograniczenia.
- **Tryb magnetyczny nie działa w lesie.** Anomalie biorą się ze stalowej konstrukcji.
  W terenie otwartym pole jest gładkie — obserwacją staje się wysokość i kształt terenu.

---

## 5. Wniosek dla architektury

Dwa środowiska, dwie różne obserwacje, **jeden filtr**:

| | Budynek / podziemia / zagłuszanie | Las / góry |
|---|---|---|
| Co zawodzi | pozycja | łączność |
| Kurs | żyroskop (magnetometr bezużyteczny) | żyroskop **+ magnetometr** (pole czyste) |
| Obserwacja pozycji | mapa anomalii magnetycznych | **profil wysokości + graf szlaków** |
| Ograniczenie mapą | ściany i korytarze | sieć szlaków, stoki, cieki |
| Inicjalizacja | ostatni fix GNSS / kod QR | fix GNSS (zwykle dostępny) |
| Skala | komórka 1 m, trasa 100 m | komórka 10–30 m, trasa 10–20 km |
| Produkt | „gdzie jestem” | „niech ktoś się dowie, gdzie jestem” |

To, co się nie zmienia: detekcja kroku, filtr orientacji z ZARU, filtr cząsteczkowy,
ograniczenie mapą, uczciwa elipsa niepewności, format nagrań, narzędzie replay.
**Około 80% istniejącego kodu przechodzi bez zmian.**

---

## Źródła

- [Effects of nearby trees on GNSS positional accuracy in a forest environment — PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0283090)
- [Działania ratownicze TOPR — podsumowanie 2025](https://dlapilota.pl/wiadomosci/polska/dzialania-ratownicze-topr-w-2025-roku)
- [Ponad dwie trzecie Polski w zasięgu zakłóceń sygnałów GNSS](https://gisplay.pl/nawigacja-satelitarna/12601-ponad-dwie-trzecie-polski-w-zasiegu-zaklocen-sygnalow-gnss.html)
- [Emergency SOS via Satellite — Polska wciąż na liście oczekujących (iMagazine, VII 2026)](https://imagazine.pl/2026/07/24/emergency-sos-via-satellite-trafia-do-andory-i-islandii-polska-wciaz-na-liscie-oczekujacych/)
- [Numer alarmowy 112 odbierze SMS-a — stan prac (Spider's Web, V 2025)](https://spidersweb.pl/2025/05/na-numer-112-bedzie-mozna-napisac-sms.html)
- [Jak działa aplikacja RATUNEK i co się dzieje bez zasięgu](https://mynaszlaku.pl/jak-dziala-aplikacja-ratunek/)
