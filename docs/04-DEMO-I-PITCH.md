# Demo i pitch

---

## 1. Scenariusz — konkretny użytkownik, konkretna liczba

> Ratownik wchodzi do dwunastopiętrowego biurowca po pożarze. GNSS nie działa we wnętrzu
> nawet w normalnych warunkach. Zasilanie jest odcięte, więc nie ma Wi-Fi ani beaconów.
> Widoczność: pół metra. Musi wejść, przeszukać piętro i **wyjść tą samą drogą**.
>
> Wymaganie: wiedzieć, gdzie jest wyjście, z dokładnością pozwalającą trafić w drzwi
> o szerokości 90 cm. To znaczy **błąd poniżej 2 m**.

Ten sam problem dotyczy: żołnierza w tunelu albo metrze, poszukiwań w kopalni,
inwentaryzacji w hali bez zasięgu, nawigacji w parkingu podziemnym.

Wspólny mianownik: **żadnej infrastruktury, żadnego sygnału z zewnątrz, tylko telefon.**

---

## 2. Przebieg prezentacji — 5 minut

| Czas | Co się dzieje | Kto |
|---|---|---|
| 0:00–0:30 | **Problem.** Jedno zdanie scenariusza + zdanie „GPS nie działa w budynkach, a beaconów w płonącym biurowcu nikt nie rozstawił”. | mówca |
| 0:30–1:00 | **Pomysł.** „Każdy budynek ma własny magnetyczny odcisk palca — stalowa konstrukcja zniekształca pole ziemskie w sposób unikalny i stabilny. To, co psuje kompas, jest naszą mapą.” | mówca |
| 1:00–2:30 | **Demo live.** Operator z telefonem obchodzi salę / wychodzi na korytarz i wraca. Na projektorze rysuje się ślad. **Dwie linie naraz:** pomarańczowa = czyste PDR (ucieka), niebieska = nasz system (trzyma się korytarza). | operator + mówca |
| 2:30–3:00 | **Moment dowodowy.** Operator wraca do punktu startu. Na ekranie: **„błąd zamknięcia: 0,8 m po 96 m trasy”**. Cisza na trzy sekundy. | operator |
| 3:00–3:40 | **Uczciwość.** „System pokazuje też, jak bardzo *nie* wie” — elipsa niepewności. Wchodzimy w obszar bez mapy, elipsa rośnie. „System, który mówi »jestem tu ±12 m«, jest użyteczny. System, który mówi »jestem tu« i kłamie, jest niebezpieczny.” | mówca |
| 3:40–4:20 | **Liczby.** Slajd z tabelą ablacji (patrz niżej) + wyniki z prawdziwych przejść. | mówca |
| 4:20–5:00 | **Co dalej.** Domknięcie pętli (magnetyczny SLAM), piętra z barometru, crowdsourcing mapy przez kolejnych użytkowników. | mówca |

### Reguły sceny

- **Nie tłumacz architektury.** Nikogo nie obchodzi FastAPI. Obchodzi ich, że działa
  w trybie samolotowym.
- **Pokaż tryb samolotowy na ekranie.** To jeden gest, a rozbraja połowę pytań.
- **Nie mów „symulacja”, jeśli to replay nagrania.** Powiedz „to powtórka przejścia
  z 14:32, z 23 punktami kontrolnymi — dlatego mogę pokazać wam prawdziwy błąd”.
  Replay z ground truth jest **mocniejszym** dowodem niż demo live.

---

## 3. Tabela na slajd

Pętla 96 m, bias żyroskopu 0,008 rad/s (typowy dla telefonu), średnia z 5 przebiegów:

| Co włączone | RMSE | CEP50 | Błąd zamknięcia |
|---|---|---|---|
| Sam krokomierz (PDR) | 5,08 m | 3,75 m | 13,35 m — **13,9% drogi** |
| + geometria budynku | 1,63 m | 1,11 m | 1,03 m — 1,1% |
| + mapa magnetyczna | 0,60 m | 0,57 m | 0,35 m — 0,4% |
| **+ obie** | **0,57 m** | **0,45 m** | **0,51 m — 0,5%** |

Mapa magnetyczna zbudowana z jednego przejścia kalibracyjnego, wyniki uśrednione
z **pięciu innych** przejść (`npm run bench`).

**Zawsze powiedz, skąd są liczby.** Jeśli to dane syntetyczne — powiedz to. Jeśli
z prawdziwego przejścia — powiedz to i podaj długość trasy. Jury wyłapie przemilczenie,
a wtedy traci wiarygodność cała reszta.

---

## 4. Panel operatora

`apps/ops` → `http://<laptop>:8000`. Trzy wielkie przyciski, nic więcej:

- **GNSS OK** — stan wyjściowy, aplikacja pokazuje pozycję z GNSS.
- **GNSS ZAGŁUSZONY** — aplikacja przechodzi na nawigację magnetyczno-inercyjną.
  To jest moment, w którym zaczyna się demo.
- **GNSS PODROBIONY** — GNSS podaje fałszywą pozycję, aplikacja wykrywa niespójność
  z trajektorią inercyjną i ostrzega. To jest scenariusz, którego nikt inny nie pokaże.

Panel eliminuje wpisywanie komend w terminalu na scenie. Jeśli padnie — nawigacja działa dalej.

---

## 5. Checklista sprzętowa (zrobić przed H40, nie w dniu prezentacji)

- [ ] scrcpy przez **USB** przetestowane na **docelowym** projektorze i rozdzielczości.
- [ ] Kabel USB-C, który na pewno przesyła dane (nie tylko ładuje).
- [ ] Debugowanie USB włączone, komputer autoryzowany w telefonie.
- [ ] Powerbank + telefon zapasowy z **tym samym** buildem i **tymi samymi** mapami.
- [ ] Tryb samolotowy przetestowany — aplikacja musi działać bez sieci.
- [ ] Jasność ekranu i wygaszanie: `expo-keep-awake` działa.
- [ ] Trzy nagrania zapasowe w aplikacji, gotowe do odtworzenia.
- [ ] Film z udanego przejścia (ostatnia deska ratunku).
- [ ] Korytarz demo przetestowany o tej samej porze dnia — pole magnetyczne nie zmienia
      się w czasie, ale winda albo przesunięta szafa potrafią zmienić lokalną anomalię.

---

## 6. Przygotowane odpowiedzi na trudne pytania

**„IndoorAtlas robi to od 2012.”**
Tak, i to dowód, że fizyka działa. Różnice: (1) ich rozwiązanie wymaga chmury, nasze
liczy wszystko na telefonie w trybie samolotowym; (2) ich mapa wymaga profesjonalnego
surveyu obiektu, nasza powstaje w locie, przez pierwszego użytkownika, który wejdzie;
(3) my pokazujemy skalibrowaną niepewność, nie punkt udający pewność.

**„Mapa magnetyczna się starzeje.”**
Konstrukcja budynku — nie. Meble i windy — tak, lokalnie. Dlatego filtr nie ufa mapie
bezwarunkowo: to jedna z trzech obserwacji, a nie jedyna. Przy rozjeździe rośnie elipsa
niepewności, co widać na ekranie. Dodatkowo każde kolejne przejście douczą mapę.

**„Co, jeśli telefon jest w kieszeni?”**
Dziś system zakłada trzymanie przed sobą i mówimy to wprost. Estymacja misalignmentu
(PCA na poziomej składowej przyspieszenia) jest następna w kolejce — patrz `docs/02` §8.

**„Skąd wiecie, gdzie zaczynacie?”**
Trzy drogi: ostatni fix GNSS sprzed wejścia, kod QR albo naklejka przy drzwiach,
wskazanie palcem na mapie. Jest też tryb lokalizacji globalnej — cząstki rozsypane
po całej mapie i zbieżność po kilkudziesięciu krokach.

**„Ile to zużywa baterii?”**
Trzy czujniki przy 100 Hz plus ekran. Zmierzyć i podać prawdziwą liczbę — nie zgadywać.
Bez ekranu (telefon w kieszeni, nawigacja przez wibracje) będzie istotnie mniej.

**„A jeśli filtr się pomyli?”**
Pomyli się. Wtedy rośnie elipsa i spada `N_eff` — użytkownik to widzi. To jest cecha,
nie usterka: alternatywą jest system, który myli się po cichu.

---

## 7. Czego nie obiecywać

- Nie mówić „dokładność 50 cm” bez podania, na jakiej trasie i przy jakiej mapie.
- Nie mówić „działa w każdym budynku” — bez mapy magnetycznej system degraduje się do
  PDR z geometrią, co jest dobre, ale nie jest tym samym.
- Nie mówić „zastąpi GPS” — to uzupełnienie na czas, gdy GPS nie działa.
- Nie pokazywać danych syntetycznych bez powiedzenia, że są syntetyczne.
