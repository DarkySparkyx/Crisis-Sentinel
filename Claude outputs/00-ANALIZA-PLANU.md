# Analiza planu „ShadowNav / Ariadna” — co jest nie tak i dlaczego

Dokument ocenia oryginalny plan (`gemini-code-1789168260056.md`). Uwagi są uszeregowane
od najgroźniejszych. Przy każdej: **na czym polega problem**, **co się stanie, jeśli
zostanie**, i **jak to naprawić**.

Krótkie streszczenie: plan jest dobrze zorganizowany jako *lista zadań*, ale ma jedną
sprzeczność u podstaw (punkt 1), jedną poważną wadę harmonogramu (punkt 11) i nie
definiuje, co znaczy „działa” (punkt 2). Te trzy rzeczy zdecydują o wyniku.

---

## A. Błędy koncepcyjne

### 1. Magnetometr jest jednocześnie kompasem i źródłem sygnału — to się wyklucza
Plan zapisuje w Fazie 2: *„Wyliczanie wektora ruchu: Krok * Kąt (z Żyroskopu/Magnetometru)”*,
a projekt nazywa się „magnetic”. Problem: **wewnątrz budynków pole magnetyczne jest
zniekształcone przez zbrojenie, instalacje i konstrukcje stalowe — typowo o 20–90°**.
To zniekształcenie jest dokładnie tym, co czyni magnetyczny „odcisk palca” miejsca
unikalnym. Ta sama właściwość czyni magnetometr **bezużytecznym jako kompas**
w tym samym miejscu.

*Skutek:* kurs skacze o dziesiątki stopni przy każdej framudze, trajektoria wygląda
jak kardiogram, a na scenie nie da się tego wytłumaczyć.

*Naprawa:* kurs **wyłącznie z żyroskopu** (przyrostowo), magnetometr wchodzi do korekty
kursu tylko gdy pole wygląda na ziemskie (|B| ≈ 49 µT i inklinacja ≈ 67° dla Polski).
Zaimplementowane: `AttitudeFilter` + `magFeature().clean`.

### 2. Nie zdefiniowano, co znaczy „działa”
Plan nie ma ani jednej metryki. W UI pojawia się `"Distance: 450m ± 20m error margin"` —
skąd te 20 m? Bez ground truth nie da się powiedzieć, czy system jest dokładny
na 1 m czy na 30 m, a jury zapyta o to w pierwszej minucie.

*Naprawa:* zdefiniowane metryki i procedura pomiaru — `docs/01`, sekcja „Metryki”.
Minimum: **błąd zamknięcia pętli**, **CEP50/CEP95 względem punktów kontrolnych**,
**zgodność deklarowanej niepewności z faktycznym błędem**.

### 3. Brak estymacji biasu żyroskopu (ZARU) i zerowej prędkości (ZUPT)
Żyroskop MEMS w telefonie ma bias rzędu 0,005–0,02 rad/s, który zmienia się z temperaturą.
0,008 rad/s to **27° dryfu kursu na minutę**. Po 3 minutach marszu trajektoria jest obrócona
o kąt prosty.

*Skutek:* to jest ta awaria, która zabije demo — ślad będzie „ładny”, ale skręcony.

*Naprawa:* wykrywanie bezruchu (wariancja akcelerometru + moduł żyroskopu), uśrednianie
biasu w postoju. Zaimplementowane w `AttitudeFilter` (`stationary`, `bias`).
W pomiarze na syntetycznych danych: bez tego błąd zamknięcia pętli 96 m rośnie z 0,5 m do 13,6 m.

### 4. Detekcja kroku z „osi Z akcelerometru”
Plan: *„licznik kroków (peak detection z osi Z akcelerometru)”*. Oś Z telefonu pokrywa się
z pionem **tylko gdy telefon leży płasko ekranem do góry**. Trzymany w ręce pod kątem 45°,
w kieszeni albo przy uchu — nie.

*Naprawa:* rzutowanie przyspieszenia na bieżący wektor grawitacji z filtru orientacji.
Zaimplementowane w `StepDetector.push(t, acc, gravityDev)`.

### 5. Brak rozróżnienia „kurs telefonu” vs „kierunek marszu”
To dwie różne wielkości (misalignment). Telefon trzymany bokiem albo w kieszeni daje kurs
przesunięty o stały (ale nieznany) kąt. Plan traktuje je jako jedno.

*Naprawa MVP:* wymuszamy regulaminem trzymanie telefonu przed sobą (i mówimy to na scenie —
uczciwie). *Naprawa docelowa:* filtr cząsteczkowy estymuje offset kursu jako składową stanu
(`th` + `bw` w `ParticleFilter`), więc systematyczny błąd jest uczony automatycznie.

### 6. LKP (Last Known Position) nie ma skąd się wziąć
Cała nawigacja jest względna wobec punktu startowego. Jeśli GNSS jest zagłuszony
**od początku**, to nie ma LKP. Plan nie mówi o tym ani słowa.

*Naprawa:* trzy uzupełniające się drogi, opisane w `docs/01`: ostatni fix GNSS sprzed
wejścia, kod QR / naklejka w drzwiach (`kind: "anchor"`), ręczne wskazanie na mapie.
Plus tryb *global localization* — rozsypanie cząstek po całej mapie i zbieżność po
kilkudziesięciu krokach (`ParticleFilter.initGlobal`).

### 7. Barometr oznaczony jako „opcjonalny”
Barometr to najtańszy i najpewniejszy detektor zmiany piętra (±0,3 hPa ≈ ±2,5 m).
Jeśli demo jest w budynku wielopoziomowym, a system „gubi piętro”, cała reszta jest bez znaczenia.

*Naprawa:* barometr od początku w strumieniu danych (`BaroSample`), detekcja pięter jako
oddzielna, prosta warstwa — nie mieszamy jej z filtrem 2D.

### 8. „Zagłuszanie GPS” potraktowane jako wyłączenie GPS
Realny jamming daje spadek C/N0 i utratę fixa. Realny **spoofing** daje fix, który wygląda
normalnie, ale jest fałszywy — i to jest groźniejszy przypadek. Plan zna tylko „GPS SIGNAL LOST”.

*Naprawa:* prosty detektor niespójności: skok pozycji przekraczający v_max·Δt, rozjazd
z trajektorią PDR powyżej progu, C/N0 poniżej progu. Trzy warunki, ~30 linii kodu, a robi
ogromną różnicę w pitchu (patrz `docs/04`, scenariusz SPOOFED).

---

## B. Błędy architektoniczne

### 9. Serwer Pythonowy jest na ścieżce krytycznej systemu, który ma działać offline
Plan każe Pythonowi serwować mapy (`MapService`) i streamować telemetrię (`TelemetryStream`)
przez WebSocket do aplikacji. Jednocześnie produkt nazywa się „Offline Navigation”.

*Skutek:* jury zobaczy, że telefon gada z laptopem, i pierwsze pytanie brzmi: „to co się
stanie, jak nie będzie serwera?”. Odpowiedź „nic nie działa” kończy prezentację.

*Naprawa:* **telefon liczy wszystko sam, w trybie samolotowym**. Serwer (`apps/ops`) robi
tylko: zbiera nagrania, wydaje mapy do wgrania, steruje sceną demo. Można go wyłączyć
w trakcie prezentacji — i właśnie to należy zrobić na scenie, demonstracyjnie.

### 10. Cała matematyka w JS w wątku UI React Native
Przy 100 Hz z trzech czujników to 300 zdarzeń/s przez most do JS. Jeśli w callbacku
znajdzie się `setState`, aplikacja zatnie się na scenie.

*Naprawa:* dwa oddzielne tempa. Czujniki → `Pipeline` (czysta matematyka, zero Reacta).
Filtr cząsteczkowy uruchamiany **na zdarzenie kroku**, czyli ~2 Hz, nie 100 Hz. UI
odświeżane osobnym timerem 8 Hz. Zmierzone: 1000 cząstek × 138 kroków = ~150 ms w Node,
z dużym zapasem na telefon.

### 11. Symulator/replay zaplanowany na godzinę 30 — to najkosztowniejszy błąd w harmonogramie
Plan umieszcza tryb symulatora w Fazie 4 (godziny 30–40), a nagrywanie ścieżek testowych
w Fazie 5 (godziny 40–48). Oznacza to, że przez pierwsze 30 godzin **każda zmiana parametru
algorytmu wymaga wyjścia z telefonem na korytarz**.

Realny koszt: jedna iteracja = 10 minut zamiast 10 sekund. Przy 50 iteracjach strojenia
to 8 godzin, których nie ma.

*Naprawa:* **replay powstaje w pierwszych 4 godzinach**, przed algorytmem. W tym repo
jest gotowy: `packages/replay` + generator danych syntetycznych z ground truth co do
centymetra. Zespół stroi algorytm zanim ktokolwiek wyjdzie z pokoju.

### 12. Dwie implementacje tej samej matematyki (JS w aplikacji, Python w analizie)
Plan przewiduje `Pandas`/`NumPy` do „mockowania i transformacji logów”. W praktyce powstaje
druga wersja PDR w Pythonie, potem się rozjeżdżają, potem nikt nie wie, która ma rację.

*Naprawa:* **jeden rdzeń w TypeScripcie** (`packages/core`), bez zależności, uruchamiany
natywnie przez Node 22 (`node --experimental-strip-types`, domyślnie włączone) **i** przez
Metro w React Native. Ta sama funkcja liczy w aplikacji i w narzędziu do strojenia.

### 13. „Expo bez konfiguracji natywnej” + mapy wektorowe offline — to się wyklucza
Plan reklamuje Expo jako *„kompilację na iOS i Android bez konfiguracji natywnej”* i w tym
samym akapicie proponuje `react-native-maps` albo `Mapbox GL` z obsługą offline. Oba to
moduły natywne: wymagają `expo prebuild` / dev clienta, a Mapbox dodatkowo tokenu.
Pierwszy build dev clienta to 20–40 minut, których nikt nie wliczył.

*Naprawa:* mapę rysujemy w `react-native-svg` w lokalnym układzie metrycznym — działa
w Expo Go, zero buildów, natychmiastowy iteracja. Kafle wektorowe to zadanie „jeśli
zostanie czas”, nie fundament.

### 14. Turf.js jako „biblioteka do matematyki przestrzennej”
Turf operuje na stopniach WGS84 i jest zoptymalizowany pod duże odległości. My pracujemy
w lokalnym układzie metrycznym na dystansach 1–200 m, gdzie potrzebne są cztery funkcje:
odległość punkt-odcinek, przecięcie odcinków, azymut, transformacja ENU↔WGS84.
Cały Turf to ~500 kB bundla za coś, co ma 60 linii.

*Naprawa:* `packages/core/src/geo.ts` + `graph.ts`. Zero zależności.

### 15. GeoPandas / Shapely w `requirements.txt` na hakatonie
GeoPandas ciągnie GDAL. Instalacja potrafi zająć pół godziny i wysypać się na brakującej
bibliotece systemowej — o 2 w nocy, na cudzym laptopie.

*Naprawa:* GeoJSON to zwykły JSON. `apps/ops/requirements.txt` ma trzy pozycje.

### 16. Sprzeczność w wielkości obszaru mapy
API mówi `radius=5000` (~5 km), onboarding mówi „obszar max 2x2 km”, UI mówi
„Map: Cached 5km2”. Trzy różne liczby. Poza tym samo istnienie endpointu `bbox`
sugeruje pobieranie mapy w locie, co przeczy założeniu offline.

*Naprawa:* mapa jest **artefaktem wgrywanym do aplikacji przed misją**, nie zasobem
pobieranym w trakcie. Jeden plik, jedna wersja, znany rozmiar.

### 17. Brak persystencji
Nigdzie nie napisano, gdzie lądują: nagrania, mapa magnetyczna, stan sesji. Przy restarcie
aplikacji (a zdarzy się, także na scenie) wszystko przepada.

*Naprawa:* nagrania na dysk telefonu (`Recorder` → `expo-file-system`), mapa magnetyczna
eksportowana do JSON, mapa obiektu jako asset w bundlu.

### 18. Brak wersjonowania formatu danych
`schema_version` nie występuje. Nagranie z dnia 1 nie sparsuje się parserem z dnia 2,
a nikt nie będzie wiedział dlaczego.

*Naprawa:* `schema_version: 2` w nagłówku nagrania i w mapie magnetycznej; walidacja
przy wgrywaniu na serwer (`apps/ops/main.py` odrzuca zły nagłówek od razu).

### 19. Model telemetrii nie ma pól, bez których fuzja jest niemożliwa
Brakuje: statusu kalibracji magnetometru, odczytu **nieskalibrowanego** wraz z biasem
(bez tego nie da się zrobić własnej kalibracji hard-iron), kwaternionu/rotation vector,
znaczników ground truth.

*Naprawa:* `types.ts` — typy `MagUncalSample`, `MarkSample`, `BaroSample`, `GpsSample`.

### 20. Timestamp jako „UNIX epoch”
Android podaje `SensorEvent.timestamp` w **nanosekundach od startu urządzenia**, nie w epoce.
Mieszanie tych dwóch osi czasu (albo poleganie na czasie ściennym, który potrafi skoczyć
przy synchronizacji NTP) rozsypuje fuzję w sposób trudny do zdiagnozowania.

*Naprawa:* jedna monotoniczna oś czasu sesji w milisekundach, stemplowana w warstwie
akwizycji (`SensorHub.now()`). Czas ścienny tylko w nagłówku, do opisu.

Dodatkowo: `expo-sensors` zwraca akcelerometr **w jednostkach g, nie m/s²** — łatwo to
przeoczyć i dostać kroki o długości 3 m. Uwzględnione w `src/sensors.ts`.

---

## C. Błędy harmonogramu i organizacji

### 21. Kolejność faz jest odwrócona
Narzędzia do strojenia (replay, nagrania, metryki) są na końcu, a powinny być na początku —
patrz punkt 11.

### 22. Zero bufora na integrację
48 godzin rozpisane co do minuty, bez marginesu. Realnie ostatnie 6–8 godzin zjada
integracja, ładowarki, brak internetu i sen.

*Naprawa:* w `docs/01` ostatnie 8 godzin to wyłącznie zamrożenie, próby i pitch. Żadnych
nowych funkcji po godzinie 40 — twarda reguła.

### 23. Brak kryteriów wyjścia z faz
Nie wiadomo, kiedy faza jest skończona i można iść dalej. To prowadzi do klasycznego
scenariusza: 20 godzin na dopieszczaniu PDR i zero czasu na resztę.

*Naprawa:* każda faza w `docs/01` ma **bramkę** — konkretny, sprawdzalny warunek.

### 24. Onboarding nowej osoby oparty o „wejdź na Overpass Turbo”
Overpass QL to osobny język. Dla kogoś, kto go nie zna, to 2–3 godziny.

*Naprawa:* `tools/osm_fetch.py` z gotowym zapytaniem + `tools/make_venue.ts` do
odwzorowania korytarza z pomiaru. Zadanie schodzi do 20 minut.

### 25. Plan opisuje moduły, nie ludzi
Przy 3–4 osobach i 48 godzinach brak przypisania właściciela do każdego obszaru oznacza,
że dwie osoby napiszą to samo, a jedna rzecz nie powstanie wcale.

*Naprawa:* `docs/01`, sekcja „Role i podział pracy” — cztery role z rozłącznymi katalogami
w repo (czyli i rozłącznymi konfliktami w gicie).

---

## D. Ryzyka prezentacji

### 26. „Tryb B: Simulator Mode” w obecnej formie podważa wiarygodność
Streamowanie wcześniej nagranego CSV z laptopa do telefonu przez WebSocket, prezentowane
jako działający system, to rzecz, którą jury wyłapie — i wtedy pod znakiem zapytania staje
całe demo, także ta część, która działała naprawdę.

*Naprawa:* replay **na telefonie**, z pliku w aplikacji, **jawnie oznaczony na ekranie**
jako „REPLAY: przejście z 14:32, ground truth 23 punkty kontrolne”. Powtórka nagranego
przejścia z pokazanym błędem względem ground truth jest *mocniejszym* dowodem niż demo live,
bo pokazuje liczby. Live robimy jako drugie, dla efektu.

### 27. Brak „momentu, który zapada w pamięć”
Plan pokazuje rysującą się linię. To ładne, ale nie jest dowodem.

*Naprawa:* pętla zamknięta. Wychodzisz z punktu X, obchodzisz piętro, wracasz do X —
i na ekranie widać **liczbę**: „błąd zamknięcia 0,7 m po 96 m trasy”. To jest dowód,
który każdy rozumie w sekundę. Zmierzone na danych syntetycznych: 0,49 m przy 96 m.

### 28. `scrcpy` / AirPlay nieprzetestowane na sprzęcie
scrcpy przez USB wymaga włączonego debugowania USB i sterowników; przez Wi-Fi bywa zawodne
na sieci konferencyjnej.

*Naprawa:* checklista sprzętowa w `docs/04`, próba na docelowym projektorze **przed**
godziną 40. Zapasowo: nagrany wcześniej film z przejścia.

### 29. Brak odpowiedzi na „czym to się różni od IndoorAtlas / Google / Apple”
To pytanie padnie. Nawigacja magnetyczna w pomieszczeniach jest komercyjnie dostępna
od ponad dekady.

*Naprawa:* przygotowana odpowiedź w `docs/04`. W skrócie: pełna praca offline bez
jakiegokolwiek zaplecza chmurowego, mapa budowana przez pierwszego użytkownika w locie
(nie przez tygodniowy survey firmy zewnętrznej), oraz jawna, skalibrowana niepewność
zamiast punktu udającego pewność.

### 30. „Dual-use” bez konkretnego użytkownika
Etykieta „dual-use” bez scenariusza to slogan.

*Naprawa:* jeden konkretny użytkownik, jedno konkretne wymaganie liczbowe —
`docs/04`, sekcja „Scenariusz”. Np.: *strażak w zadymionym budynku musi wiedzieć, w którą
stronę jest wyjście, z dokładnością pozwalającą trafić w drzwi o szerokości 90 cm —
czyli błąd poniżej 2 m*. To jest teza, którą da się obronić liczbami.

### 31. Nie zaplanowano, co pokazać, gdy system się pomyli
A pomyli się. Filtr cząsteczkowy potrafi „uciec” (zdarzyło się w naszych testach przy
jednej konkretnej liczbie cząstek — patrz `docs/02`, sekcja o rougheningu).

*Naprawa:* elipsa niepewności rośnie, gdy filtr traci pewność, i to jest **cecha, nie
usterka** — pokazujemy ją jako świadomy element projektu. System, który mówi „jestem tu
±12 m”, jest użyteczny. System, który mówi „jestem tu” i kłamie, jest niebezpieczny.

---

## Czego w planie nie ma wcale, a powinno być

| Brak | Dlaczego to ma znaczenie |
|---|---|
| Kalibracja hard-iron magnetometru | Bez niej odczyty mają stały offset zależny od egzemplarza telefonu i etui; mapa z jednego telefonu nie pasuje do drugiego. `fitHardIron()` |
| Kalibracja długości kroku per-osoba | Współczynnik Weinberga różni się o ±25% między ludźmi. 20 m zmierzonego odcinka rozwiązuje problem. `calibrateK()` |
| Tryb budowania mapy (SURVEY) | Cały pomysł „magnetic” wymaga mapy. Kto i jak ją robi? `Pipeline({mode:'SURVEY'})` + `replay survey` |
| Degradacja przy braku mapy | System musi działać (gorzej) tam, gdzie mapy nie ma. Zaimplementowane: `unknownLogLik` |
| Wykrywanie rozbieżności filtru | Spadek `N_eff` i `survival` to sygnał ostrzegawczy dla użytkownika |
| Test jednostkowy czegokolwiek | O 4 rano regresja bez testów kosztuje godziny |

---

## Co w oryginalnym planie jest dobre i zostaje

- Podział na fazy z konkretnymi celami — struktura jest sensowna, kolejność wymaga korekty.
- Nacisk na plan awaryjny prezentacji. Instynkt słuszny, wykonanie do poprawy (punkt 26).
- Panel operatora zamiast wpisywania komend na scenie — bardzo dobry pomysł, zostaje
  (`apps/ops/static/index.html`).
- Minimalistyczne UI z kompasem i dystansem — właściwy kierunek; dochodzi jawna niepewność.
- Wydzielenie zadań dla nowej osoby tak, by nie kolidowały z rdzeniem — słuszna zasada,
  rozwinięta w `docs/01` na cztery rozłączne role.
