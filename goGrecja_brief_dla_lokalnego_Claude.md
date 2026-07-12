# goGrecja — brief do przekazania lokalnemu Claude Code (drugi komputer)

> **Do czego to jest:** ten plik przenosisz na komputer, na którym masz Claude Code **uruchomiony lokalnie** z folderem `D:\OneDrive\___Clode\goGrecja`. Otwórz tam Claude Code, wklej sekcję „ZADANIE" i dołącz ten plik jako kontekst. Lokalny Claude ma dostęp do Twojego dysku, więc dokończy to, czego sesja webowa nie mogła (odczyt haseł z configów + utworzenie plików wprost w folderze).

---

## 1. Podsumowanie rozmowy (sesja webowa, chmura)
Rozmowa dotyczyła projektów **e-Sylwester** i **goGrecja**. Co zrobione w tej (webowej) sesji:
- **e-Sylwester:** poprawki `cennik.html` i `dodaj.html` — statusy rezerwacji (górach = „wstępnie zarezerwowane", reszta „wolne"), lata 2025→2026 (i 2025/2026→2026/2027), pasek pakietów: całe kolorowe kafle klikalne + podświetlane; korekta pozycji „w górach"→3. Analiza konkurencji (raport HTML + tabele + scoring).
- **goGrecja:** przygotowane materiały handoverowe — rozpiska poradników (huby/klastry + backlog), formularz brakujących danych, przekazanie z instrukcją publikacji.
- **Blokada:** sesja webowa działa w chmurze (Linux), **nie ma dostępu do dysku `D:` ani OneDrive**, więc nie mogła: (a) zapisać plików w folderze goGrecja, (b) odczytać haseł z plików konfiguracyjnych projektu.

## 2. Kontekst projektu goGrecja (ustalenia z maila + Google Drive)
- **Domeny:** `gogrecja.pl` oraz `goturcja.pl` (kupione). Powiązany: `goegipt.pl`.
- **Silnik:** własny, PHP + **Smarty** (rodzina e-Sylwester, „stare bazy").
- **Serwer/hosting:** **cyber_Folks** (Lexine Gawek i Kielar, ID klienta 241620).
- **Ścieżka na serwerze:** `/home/users/gogrecja/public_html/gogrecja.pl/` (tam m.in. `Smarty/libs/...`).
- **Zasada pracy:** część zmian robiona „bezpośrednio na serwerze".
- **Zespół:** Mirek (mirek@eporady24.pl), Gerard Gawek (g.gawek@eporady24.pl), Maciek Haudek (maciek@lexine.pl / m.haudek@eporady24.pl), Iwona (i.kielar@dobryebook.pl), Mateusz (mati.kielar@gmail.com).
- **6 opracowań** (PDF w Gmailu, temat „goGrecja"/„Opracowania goGrecja", 10–11 maja 2026): koncepcja, quickstart (pierwsze decyzje), decyzje+rekomendacje 1–10, strategia SEO (Claude), analiza SEO (ChatGPT, GoEgipt+GoGrecja), praca zespołowa.
- **Hasła:** w Gmailu i Google Drive **NIE MA** zapisanych danych dostępowych do goGrecja (sprawdzone; „Metryczka hasła administracyjnego" to pusty szablon). Hasła są w plikach konfiguracyjnych projektu na dysku i/lub w panelu cyber_Folks.

## 3. ZADANIE dla lokalnego Claude Code (wklej to w oknie z folderem goGrecja)
```
Pracujesz w folderze projektu goGrecja (D:\OneDrive\___Clode\goGrecja).
Zrób dwie rzeczy:

A) ODCZYTAJ DANE DOSTĘPOWE z plików konfiguracyjnych projektu i zbierz je w jednym miejscu:
   - poszukaj plików: config.php, konfiguracja.php, db.php, database.php, .env,
     settings.php, oraz plików w podfolderach php/ serwis/ docs/;
   - wyciągnij: dane do BAZY (host, użytkownik, hasło, nazwa bazy) oraz
     ewentualne dane FTP/SSH i login do panelu admina strony;
   - NIE zmieniaj tych plików, tylko odczytaj.

B) UTWÓRZ w folderze goGrecja dwa pliki HTML:
   1. goGrecja_TEMATY.html  — rozpiska poradników (co do zrobienia + co przygotowane).
   2. goGrecja_HASLA.html   — przekazanie: dane dostępowe (uzupełnione tym, co
      odczytasz w punkcie A) + instrukcja publikacji poradników.

Gotowe wzory obu plików mam z sesji webowej (patrz sekcja 4 tego briefu) —
możesz je odtworzyć lub poprosić o wklejenie treści.
```

## 4. Gotowe pliki/wzory z sesji webowej (do wykorzystania)
Te pliki zostały już przygotowane (do pobrania z czatu / linki):
- **Rozpiska poradników (tematy):** `goGrecja_TEMATY.html` (= `go_grecja_rozpiska.html`)
  - link render: https://claude.ai/code/artifact/8eed7f39-1ab0-4f32-88e2-bfb0ed5a0fcd
- **Przekazanie (dane + instrukcja):** `goGrecja_HASLA.html` (= `artifact_go_grecja_przekazanie.html`)
  - link render: https://claude.ai/code/artifact/bc81f3b3-924a-4ef7-8256-11279083b55f
- **Formularz brakujących danych:** `go_grecja_dane_do_zebrania.html`
- **Dane z maila goGrecja:** `goGrecja_dane_z_maila.txt`
- **Instrukcja publikacji (wzór z e-Sylwester):** panel `…/admin/artykuly.html`, login `gawek`, proces: Prompt napisz → GPT → SQL → wklej; Prompt zdjęcie → GPT → jpg → tinypng → wgraj; przypisz ~5 kategorii; „Aktywny" → Zapisz.

## 5. Uwaga bezpieczeństwa
Po odczytaniu haseł trzymaj plik `goGrecja_HASLA.html` w bezpiecznym miejscu, nie publikuj. Po przekazaniu projektu rozważ zmianę haseł.
