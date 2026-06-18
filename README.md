# Lexine — automatyzacja treści prawnych (pipeline AI)

Automatyczna produkcja treści SEO klasy **YMYL** dla sieci 19 serwisów prawnych
Lexine (Gawek i Kielar sp.j.) — od pobrania aktów z **Dziennika Ustaw**, przez
ocenę i routing, po **gotowe do publikacji artykuły HTML** z pełnym pakietem SEO.

Priorytet: skalowalność, **nadzór redakcyjny** i **brak halucynacji**. Pipeline
**niczego nie publikuje sam** — drafty trafiają do kolejki redakcyjnej do akceptacji.

## Architektura

```
 Dz.U. (API ELI Sejmu)                          ← źródło (na razie; rozszerzalne)
        │  ingest.py
        ▼
   [ Akty ] ──► triage.py ──► ocena (kryteria 1–3) + routing do 1 z 19 serwisów
        │  filtr jakości + kadencja (state.py)
        ▼
   research.py ──► web_search: realne źródła + cytaty
        ▼
   generate.py ──► v1 (opus-4-8, format jak artykuły wzorcowe, panel pipeline)
        ▼
   review.py   ──► RECENZENT „inny chat" (opus-4-8 + web_search) → uwagi
        ▼
   revise.py   ──► v2 (nanosi poprawki, aktualizuje panel: KOREKTA/OK)
        ▼
   publish.py  ──► wersja publikacyjna (panel usunięty, gotowe do CMS)
        ▼
   output/review_queue/<serwis>/<akt>.{v1,v2,publication}.html (+ .review.txt, .json)
```

Przepływ odwzorowuje docelowy proces: **kilka źródeł → temat → artykuł podobny do
istniejących → recenzja przez osobny model → wersja v2 → publikacja**. Krok grafiki
(„zdjęcie") jest na razie pominięty (do dołożenia później jako brief do modelu graficznego).

| Etap | Plik | Co robi |
|------|------|---------|
| Ingest | `ingest.py` | Świeże akty z **api.sejm.gov.pl/eli** — Dz.U. (DU) + Monitor Polski (MP), okno 21 dni |
| Triage + routing | `triage.py` | Structured output: ocena 0–10 + serwis + kategoria + kąt |
| Research | `research.py` | `web_search` zbiera źródła i komentarze z atrybucją |
| Generacja v1 | `generate.py` | opus-4-8, format **identyczny z artykułami wzorcowymi** (cache) |
| Recenzja | `review.py` | „Inny chat": opus-4-8 + web_search niezależnie weryfikuje fakty w ISAP |
| Wersja v2 | `revise.py` | Nanosi uwagi recenzenta, aktualizuje panel pipeline |
| Publikacja | `publish.py` | Usuwa panel recenzji → czysty HTML do CMS |
| Weryfikacja | `verify.py` | Rozdziela HTML od listy „DO WERYFIKACJI"; zbiera placeholdery |
| Kadencja/stan | `state.py` | Idempotencja + priorytet eporada24, rzadszy content niszowy |
| Orkiestracja | `pipeline.py` | Spina całość; selekcja wg jakości i kadencji |
| CLI | `cli.py` | `ingest` / `triage` / `run` |

### Format docelowy

`prompts/examples/*.html` to Twoje **artykuły wzorcowe** (preview v2 z panelem
pipeline). Generator i reviser dostają je jako referencję, żeby nowe teksty miały
identyczny `<style>`, układ sekcji, karty przykładów i bloki CTA
(`../zapytaj_prawnika.html`). Panel pipeline (`TYTUL_H1`, `SEO_*`, `NANIESIONO PO
RECENZJI`, `DO_WERYFIKACJI`) jest w wersjach v1/v2, a `publish.py` usuwa go w wersji
publikacyjnej.

## Instalacja

```bash
pip install -r requirements.txt
cp .env.example .env        # i wpisz ANTHROPIC_API_KEY
```

## Użycie

```bash
export PYTHONPATH=src

# 1. Podejrzyj świeże akty (DU+MP) z okna ostatnich 21 dni
python -m lexine.cli ingest --freshness-days 21

# 2. Oceń i zrutuj (kolumna „ciekawość 0–3" dla nie-prawnika)
python -m lexine.cli triage --freshness-days 14

# 3. Pełny przebieg → drafty do kolejki redakcyjnej (max 3 artykuły)
python -m lexine.cli run --max 3

# Dry-run: pokaż co by powstało, bez płatnych wywołań generacji
python -m lexine.cli run --dry-run
```

### Świeżość i odbiorca (twarde reguły)

- **Świeżość** — bierzemy tylko akty **ogłoszone w ostatnich ~21 dniach** (maks.
  2–3 tygodnie). Steruje `--freshness-days` lub `LEXINE_FRESHNESS_DAYS`.
- **Ciekawe dla nie-prawnika** — triage ocenia osobny wymiar `layperson_interest`
  (0–3) jako **kryterium nadrzędne**; akty techniczne/administracyjne (częste w MP)
  są odrzucane. Próg: `LEXINE_MIN_LAYPERSON` (domyślnie 2).
- **Źródła** — Dziennik Ustaw (`DU`) **i Monitor Polski** (`MP`); `--publishers DU,MP`.

Dla każdego tematu w `output/review_queue/<serwis>/` powstaje komplet:

| Plik | Co to |
|------|-------|
| `<klucz>.v1.html` | Pierwsza wersja (przed recenzją) |
| `<klucz>.v2.html` | Wersja po recenzji merytorycznej (z panelem KOREKTA/OK) |
| `<klucz>.publication.html` | Czysty HTML do CMS (panel usunięty) |
| `<klucz>.review.txt` | Surowe uwagi recenzenta (werdykt, korekty, źródła) |
| `<klucz>.json` | Metadane: ocena, werdykt, korekty, lista „do weryfikacji" |

Status każdego: `DO_AKCEPTACJI_REDAKCJI` — nic nie idzie do publikacji bez redakcji.

Liczbę rund recenzja→v2 ustawia `LEXINE_REVIEW_ROUNDS` (domyślnie 1).

## Decyzje modelowe (ważne)

- **Generacja v1, recenzja, v2: `claude-opus-4-8`** — najlepsza polszczyzna
  prawnicza, pilnuje formatu i zasad anty-halucynacyjnych. Treść YMYL → jakość > koszt.
- **Triage: `claude-sonnet-4-6`** — tańszy, do masowej oceny/klasyfikacji. To
  świadomy kompromis koszt/wolumen; ustaw `LEXINE_MODEL_TRIAGE=claude-opus-4-8`
  jeśli chcesz maks. trafność.
- **Twoje prompty były pisane pod `claude-opus-4-7` i `temperature 0.4–0.6`.**
  Zaktualizowane: opus‑4‑8 jest aktualny, a na opus‑4‑8/4‑7 **`temperature` jest
  usunięte** (zwraca 400). Determinizm i „nie zmyślaj dat" osiągamy **promptem +
  structured output + web_search grounding**, nie temperaturą. Używamy
  `thinking: adaptive`.

Modele nadpiszesz w `.env` (`LEXINE_MODEL_*`) lub `src/lexine/config.py`.

## Jak pilnujemy braku halucynacji (4 niezależne warstwy)

1. **Grounding** — `research.py` najpierw wyszukuje realne źródła (`web_search`);
   model pisze z dostarczonego kontekstu, nie z pamięci.
2. **Niezależna recenzja** — `review.py` to OSOBNE wywołanie/rola (opus-4-8 +
   web_search), które weryfikuje fakty w ISAP i zgłasza korekty (np. odwrócone
   przepisy przejściowe). `revise.py` nanosi je w v2.
3. **Placeholdery + blok weryfikacji** — czego nie potwierdzono, model oznacza
   `{{DO_WERYFIKACJI: ...}}`; `verify.py` zbiera je do `.json`.
4. **Human-in-the-loop** — pipeline nie publikuje; wszystko czeka na redakcję.

## Skalowanie i koszt

- **Prompt caching** na stałym system prompcie (generacja) i rubryce (triage) —
  ~90% taniej na powtarzanym prefiksie przy wielu aktach.
- **Kadencja** (`config/services.yaml`): eporada24 co ~2 dni, serwisy niszowe
  co 7–30 dni — sieć skaluje się bez zalewania niszy.
- Do dużych wsadów rozważ **Batches API** (−50%) dla triage'u całego rocznika.

## Konfiguracja serwisów

`config/services.yaml` — 19 serwisów, ich dziedziny, kategorie breadcrumb,
`tier` (priorytet) i `cadence_days` (jak często content). Edytuj bez zmian w kodzie.

## Struktura repo

```
config/services.yaml     # katalog 19 serwisów + kadencja
prompts/                 # system prompt generatora + szablon user message
src/lexine/              # pakiet pipeline'u
output/review_queue/     # drafty do akceptacji redakcji (generowane)
state/manifest.json      # stan: idempotencja + kadencja (generowany)
```
