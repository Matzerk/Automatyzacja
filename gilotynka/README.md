# Gilotynka 🪓 — wersja na hosting kei.pl (PHP + MySQL)

Kopia aplikacji „Gilotynka" z **nowym sposobem zapisu**: zamiast `localStorage`
i Google Sheets dane trzyma **baza MySQL** na Waszym hostingu, a logiką steruje
**backend PHP**. Aplikacja:

- działa dla **wielu osób**, z **logowaniem** i **rolami**:
  - **nadzorca** (`supervisor`) — widzi **wszystkich** pracowników, **przełącza się**
    między nimi (lista u góry: „👥 Wszyscy" → konkretna osoba), tworzy/edytuje/usuwa
    i **przypisuje** zadania dowolnemu pracownikowi oraz zarządza kontami,
  - **wykonawca** (`worker`) — widzi i obsługuje **tylko swoje** zadania, **sam dodaje**
    własne zadania (z podpowiedziami wcześniejszych nazw) i wpisuje **godziny** pracy,
    oznacza je jako ukończone/pominięte;
- każde zadanie ma **właściciela** (`owner_id`) i opcjonalne **godziny** (`hours`) —
  pracownik wykazuje *co* i *ile godzin* zrobił danego dnia; w „Ukończono" jest
  **dzienna suma godzin**;
- **synchronizuje** dane między urządzeniami (odświeżanie co ~6 s);
- **codzienny reset** zadań codziennych/cyklicznych (status + wyczyszczenie godzin)
  robi **CRON** hostingu;
- jest w **podkatalogu** — docelowo `miroslawkielar.com/gilotynka` (ścieżki względne).

> Model danych: jedna baza, jedna instalacja. „Osobna gilotynka per pracownik"
> (jak zakładki w Google Sheets) jest realizowana logicznie — przez właściciela
> zadania + przełącznik pracownika u góry. Pracownik widzi tylko siebie, nadzorca
> przełącza się między wszystkimi.

Wymagania hostingu (kei.pl je spełnia): **PHP 8.0+**, **MySQL**, **CRON**, **FTP**.

---

## Pliki

```
gilotynka/
├─ index.html            ← interfejs (z ekranem logowania)
├─ app.js                ← logika + komunikacja z API (fetch)
└─ api/
   ├─ api.php            ← API: logowanie, zadania, konta
   ├─ db.php             ← połączenie z bazą + sesja + helpery
   ├─ install.php        ← instalator (uruchom RAZ, potem usuń)
   ├─ cron_reset.php     ← codzienny reset (dla CRON)
   ├─ schema.sql         ← struktura tabel MySQL
   ├─ config.example.php ← wzór konfiguracji → skopiuj do config.php
   └─ .htaccess          ← blokuje dostęp do config/schema z przeglądarki
```

---

## Krok 1 — Baza danych (panel kei.pl)

1. Panel kei.pl → **Usługi → Bazy danych** → **Utwórz bazę MySQL**.
2. Zapisz: **nazwę bazy**, **użytkownika**, **hasło** i **host** (zwykle `localhost`).

## Krok 2 — Konfiguracja

1. Skopiuj `api/config.example.php` → `api/config.php`.
2. Wpisz dane bazy z Kroku 1.
3. Ustaw **dwa losowe tokeny** (`install_token`, `cron_token`) — dowolne długie ciągi.
4. W `install_users` wpisz konta startowe (e-mail, imię, rola, hasło). Przykład:
   ```php
   'install_users' => [
     ['email'=>'tata@dom.pl', 'name'=>'Tata', 'role'=>'supervisor', 'password'=>'mocneHaslo1'],
     ['email'=>'mama@dom.pl', 'name'=>'Mama', 'role'=>'supervisor', 'password'=>'mocneHaslo2'],
     ['email'=>'syn@dom.pl',  'name'=>'Syn',  'role'=>'worker',     'password'=>'mocneHaslo3'],
   ],
   ```

## Krok 3 — Wgranie plików (FTP)

1. Panel kei.pl → **Usługi → FTP** (konto FTP do domeny `miroslawkielar.com`).
2. Wgraj **całą zawartość katalogu `gilotynka/`** do folderu `gilotynka` w katalogu
   tej domeny (tak, by powstało `…/miroslawkielar.com/gilotynka/index.html`).
   > Pamiętaj o pliku `api/config.php` (jest pomijany w repo — wgrywasz go ręcznie)
   > oraz o `api/.htaccess`.

## Krok 4 — Instalacja (raz)

1. Wejdź w przeglądarce:
   `https://miroslawkielar.com/gilotynka/api/install.php?token=TWOJ_INSTALL_TOKEN`
   (token = `install_token` z `config.php`).
2. Zobaczysz log: utworzone tabele, konta i przykładowe zadania.
3. **USUŃ plik `api/install.php`** z serwera (albo zmień `install_token`).

## Krok 5 — Pierwsze logowanie

Wejdź na `https://miroslawkielar.com/gilotynka/` i zaloguj się kontem nadzorcy.
- Nadzorca widzi zakładki: **Moje zadania**, **Zadania**, **Ukończono**, **Konta**.
- Wykonawca widzi tylko **Moje zadania** i **Ukończono**.

Nowe konta dodajesz już z aplikacji: zakładka **Konta → ＋ Dodaj konto**
(możesz tam też zmieniać role i resetować hasła).

## Krok 6 — CRON (codzienny reset)

Panel kei.pl → **Usługi → CRON → Utwórz zadanie CRON**. Ustaw uruchamianie raz
dziennie (np. **00:05**). Dwie możliwości:

- **URL** (wget/curl):
  `https://miroslawkielar.com/gilotynka/api/cron_reset.php?token=TWOJ_CRON_TOKEN`
- **lub polecenie PHP** (ścieżkę do pliku weź z panelu/FTP):
  `php /home/…/miroslawkielar.com/gilotynka/api/cron_reset.php`

Reset: codzienne (✅) wracają do „w realizacji", cykliczne (🔄) do „oczekiwania".

## Krok 7 — Domena i HTTPS

- DNS domeny `miroslawkielar.com` jest już na `ns1.kei.pl` / `ns2.kei.pl`, więc
  wystarczy, że domena jest podpięta do tego hostingu (panel → **Domeny**).
- Włącz **SSL/HTTPS** dla domeny w panelu (Let's Encrypt) — logowanie powinno iść po HTTPS.

---

## Bezpieczeństwo (co już jest)

- Hasła w bazie są **hashowane** (`password_hash`), nigdy w czystym tekście.
- Sesje na **cookie httponly + SameSite=Lax**; mutacje wymagają nagłówka
  `X-Requested-With` (ochrona przed CSRF).
- **Role** pilnowane po stronie serwera: wykonawca nie utworzy ani nie skasuje
  zadania (może tylko zmieniać status).
- `config.php` i `schema.sql` zablokowane przed odczytem z przeglądarki (`.htaccess`).

## Najczęstsze problemy

| Objaw | Rozwiązanie |
|------|-------------|
| „Brak api/config.php" | Skopiuj `config.example.php` → `config.php` i uzupełnij (Krok 2). |
| „Błąd połączenia z bazą" | Złe dane w `config.php` (host/nazwa/użytkownik/hasło). |
| Install: „Zły token" | Token w URL musi = `install_token` z `config.php`. |
| „Błędny e-mail lub hasło" | Sprawdź konto w zakładce **Konta** albo zresetuj hasło. |
| Reset nie działa | Sprawdź zadanie CRON i token; godzina wg czasu serwera. |
| Logowanie nie trzyma | Włącz HTTPS dla domeny (cookie `secure`). |

---

## Lokalny podgląd (opcjonalnie)

Z katalogu `gilotynka/`, mając PHP i lokalny MySQL:
```bash
php -S 127.0.0.1:8080
```
Bez bazy zobaczysz ekran logowania; pełne działanie wymaga MySQL + `config.php`.
