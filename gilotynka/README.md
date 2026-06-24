# Gilotynka 🪓 — wersja online (Supabase + logowanie + role)

Kopia aplikacji „Gilotynka" z **nowym sposobem zapisu**: zamiast `localStorage`
i Google Sheets dane trzyma **baza Postgres w Supabase**. Aplikacja:

- działa dla **wielu osób naraz**, ze **synchronizacją na żywo** (zmiana u jednej
  osoby od razu widoczna u pozostałych),
- ma **logowanie** i **role**:
  - **nadzorca** (`supervisor`) — tworzy, edytuje, usuwa i przypisuje zadania,
  - **wykonawca** (`worker`) — widzi swoje zadania i oznacza je jako ukończone
    (nie może edytować ani kasować),
- **codzienny reset** zadań codziennych/cyklicznych robi serwer (a nie przeglądarka),
- stoi jako **strona statyczna** — wrzucasz pliki na dowolny hosting i podpinasz domenę.

> Po co role? Kilka osób (np. rodzice/przełożeni) kontroluje pracę **jednej**
> osoby. Nadzorcy rozdają i sprawdzają zadania, wykonawca je odhacza.

---

## Pliki

| Plik | Co to |
|------|-------|
| `index.html` | interfejs (wygląd jak oryginał + ekran logowania) |
| `app.js` | logika + warstwa zapisu na Supabase + realtime + role |
| `config.example.js` | wzór konfiguracji — skopiuj do `config.js` i wpisz klucze |
| `supabase/schema.sql` | **baza**: tabele, role, RLS, codzienny reset, realtime |
| `supabase/seed.sql` | opcjonalne dane startowe (lista zadań z oryginału) |
| `netlify.toml` | konfiguracja wdrożenia (Netlify) |

---

## Krok 1 — Załóż projekt Supabase (darmowy)

1. Wejdź na <https://supabase.com> → **New project** (region: Frankfurt — blisko PL).
2. Zapisz hasło do bazy. Poczekaj aż projekt wstanie (~2 min).
3. Wejdź w **SQL Editor → New query**, wklej **całą** zawartość
   `supabase/schema.sql`, kliknij **Run**. To tworzy tabele, role i reguły dostępu.
4. (Zalecane) **Database → Extensions** → włącz **`pg_cron`** (codzienny reset
   o północy). Jeśli go nie włączysz, reset można odpalać ręcznie zapytaniem
   `select public.daily_reset();`.

## Krok 2 — Konfiguracja aplikacji

1. W Supabase: **Project Settings → API**. Skopiuj **Project URL** i klucz **anon public**.
2. Skopiuj `config.example.js` → `config.js` i wpisz oba:
   ```js
   window.CONFIG = {
     url:     "https://twojprojekt.supabase.co",
     anonKey: "eyJhbGciOi...",   // klucz anon public
   };
   ```
   > Klucz `anon` jest **publiczny z założenia** — bezpieczeństwa pilnują reguły
   > RLS w bazie, nie ukrywanie klucza.

## Krok 3 — Konta i role

1. W Supabase: **Authentication → Providers → Email** — upewnij się, że jest włączone.
   Na start wyłącz „Confirm email" (Authentication → Settings), żeby konta działały
   od razu bez potwierdzania mailem.
2. **Utwórz konta** (Authentication → Users → Add user) dla każdego nadzorcy
   i dla wykonawcy. Każde nowe konto dostaje automatycznie rolę `worker`.
3. **Ustaw nadzorców** — w SQL Editor podmień e-maile i uruchom:
   ```sql
   update public.profiles set role='supervisor'
     where id in (select id from auth.users where email in
       ('nadzorca1@example.com','nadzorca2@example.com'));
   ```
   Wykonawca zostaje `worker` — nic nie trzeba robić.
4. (Opcjonalnie) Ładne imiona w aplikacji:
   ```sql
   update public.profiles set display_name='Tata'
     where id=(select id from auth.users where email='nadzorca1@example.com');
   ```

## Krok 4 — (Opcjonalnie) Dane startowe

Po ustawieniu choć jednego nadzorcy uruchom w SQL Editor zawartość
`supabase/seed.sql` — wgra listę zadań z oryginalnej apki.

## Krok 5 — Test lokalny

Z katalogu `gilotynka/`:
```bash
python3 -m http.server 8080
```
Otwórz <http://localhost:8080>, zaloguj się kontem nadzorcy. Powinieneś widzieć
zakładkę **Zadania** i móc dodawać/edytować. Zaloguj się (np. w drugiej karcie)
kontem wykonawcy — zobaczysz tylko **Moje zadania** i **Ukończono**.

## Krok 6 — Wdrożenie na domenę

Masz samą domenę, więc front stawiamy na darmowym hostingu statycznym i podpinamy
domenę. **Cloudflare Pages** (polecane) lub **Netlify** / **Vercel** — dowolny.

### Cloudflare Pages
1. <https://dash.cloudflare.com> → **Workers & Pages → Create → Pages**.
2. Połącz repo (lub „Direct upload" i wrzuć pliki z `gilotynka/`).
   Przy repo ustaw **Root directory** = `gilotynka`. Build command: puste,
   Output: `gilotynka` (lub `.` przy uploadzie).
3. **Custom domains** → dodaj swoją domenę i ustaw rekordy DNS wg instrukcji
   (jeśli domena jest już w Cloudflare — jednym klikiem).

### Netlify
1. <https://app.netlify.com> → **Add new site**.
2. „Deploy manually" — przeciągnij katalog `gilotynka/`, albo połącz repo
   z **Base directory** = `gilotynka`.
3. **Domain settings → Add custom domain** → ustaw DNS u rejestratora domeny.

> **Ważne — `config.js` nie trafia do repo** (jest w `.gitignore`). Przy
> deployu z repo wgraj `config.js` ręcznie (Cloudflare/Netlify: „upload" lub
> zmienne) **albo** odkomentuj go z `.gitignore` — klucz `anon` jest publiczny,
> więc bez obaw można go zostawić w repo, jeśli wolisz prostotę.

## Krok 7 — Domknięcie bezpieczeństwa

1. W Supabase: **Authentication → URL Configuration** — dodaj adres swojej domeny
   do **Site URL** / **Redirect URLs**.
2. Zostaw **Confirm email** włączone na produkcji, jeśli kont nie zakładasz ręcznie.
3. RLS jest już włączone (schema.sql): nikt niezalogowany nie zobaczy danych,
   a wykonawca nie zmieni cudzej treści — może tylko zmieniać status swoich zadań.

---

## Jak to działa (skrót techniczny)

- **Zapis**: `app.js` używa `@supabase/supabase-js`. Tworzenie/edycja/usuwanie
  zadań → bezpośrednio do tabeli `tasks` (dozwolone tylko nadzorcy przez RLS).
  Zmiana statusu (ukończone/pominięte/przywróć) → funkcja `set_task_status()`
  (`security definer`) — dzięki temu wykonawca może odhaczać, ale nie edytować treści.
- **Synchronizacja**: kanał Realtime na tabeli `tasks` — po każdej zmianie
  wszyscy zalogowani dostają odświeżenie widoku.
- **Reset dobowy**: `daily_reset()` + `pg_cron` (23:00 UTC ≈ północ w PL).
  Codzienne wracają do „w realizacji", cykliczne do „oczekiwania".
- **Role**: tabela `profiles` (`supervisor`/`worker`), zakładana automatycznie
  triggerem przy rejestracji.

## Najczęstsze problemy

| Objaw | Przyczyna / rozwiązanie |
|------|--------------------------|
| Alert „Brak konfiguracji" | Nie ma `config.js` lub zostały placeholdery — uzupełnij Krok 2. |
| „Invalid login credentials" | Złe hasło **lub** włączone „Confirm email" a konto niepotwierdzone. |
| Nadzorca nie widzi „Zadania" | Rola wciąż `worker` — wykonaj UPDATE z Kroku 3. |
| Zmiany nie synchronizują się | Realtime: w schema.sql jest `alter publication ... add table tasks` — sprawdź, że się wykonało. |
| Reset nie działa o północy | `pg_cron` nie włączony (Krok 1.4) albo strefa czasu — cron działa w UTC. |
