# Lexine — automatyzacja treści prawnych (pipeline AI)

Automatyczna produkcja treści SEO klasy **YMYL** dla sieci 19 serwisów prawnych
Lexine (Gawek i Kielar sp.j.) — od pobrania aktów z **Dziennika Ustaw**, przez
ocenę i routing, po **gotowe do publikacji artykuły HTML** z pełnym pakietem SEO.

Priorytet: skalowalność, **nadzór redakcyjny** i **brak halucynacji**. Pipeline
**niczego nie publikuje sam** — drafty trafiają do kolejki redakcyjnej do akceptacji.

## Architektura

```
 Dz.U. (API ELI Sejmu)
        │  ingest.py
        ▼
   [ Akty ] ──► triage.py ──► ocena (kryteria 1–3) + routing do 1 z 19 serwisów
        │                      (structured output, cache na rubryce)
        │  filtr jakości + kadencja (state.py)
        ▼
   research.py ──► web_search: realne źródła + cytaty (anty-halucynacja)
        ▼
   generate.py ──► opus-4-8 + Twój system prompt (19 sekcji), streaming, cache
        ▼
   verify.py ──► HTML  +  lista „DO WERYFIKACJI PRZEZ REDAKCJĘ"
        ▼
   output/review_queue/<serwis>/<akt>.html (+ .json)   ← akceptacja redakcji
```

| Etap | Plik | Co robi |
|------|------|---------|
| Ingest | `ingest.py` | Pobiera akty z **api.sejm.gov.pl/eli** (Dz.U., darmowe, bez klucza) |
| Triage + routing | `triage.py` | Jeden structured-output call: ocena 0–10 + serwis + kategoria + kąt |
| Research | `research.py` | `web_search` zbiera źródła i komentarze z atrybucją |
| Generacja | `generate.py` | `claude-opus-4-8`, streaming, prompt caching na system prompcie |
| Weryfikacja | `verify.py` | Rozdziela HTML od listy rzeczy do sprawdzenia przez redakcję |
| Kadencja/stan | `state.py` | Idempotencja + priorytet eporada24, rzadszy content niszowy |
| Orkiestracja | `pipeline.py` | Spina całość; selekcja wg jakości i kadencji |
| CLI | `cli.py` | `ingest` / `triage` / `run` |

## Instalacja

```bash
pip install -r requirements.txt
cp .env.example .env        # i wpisz ANTHROPIC_API_KEY
```

## Użycie

```bash
export PYTHONPATH=src

# 1. Podejrzyj świeże akty z Dz.U.
python -m lexine.cli ingest --year 2026 --since 2026-05-01 --limit 20

# 2. Oceń i zrutuj (bez generacji — sama selekcja)
python -m lexine.cli triage --year 2026 --limit 15

# 3. Pełny przebieg → drafty do kolejki redakcyjnej (max 3 artykuły)
python -m lexine.cli run --year 2026 --since 2026-05-01 --max 3

# Dry-run: pokaż co by powstało, bez płatnych wywołań generacji
python -m lexine.cli run --year 2026 --dry-run
```

Drafty: `output/review_queue/<serwis>/<klucz>.html` + `<klucz>.json` (metadane,
ocena, lista „do weryfikacji"). Status każdego: `DO_AKCEPTACJI_REDAKCJI`.

## Decyzje modelowe (ważne)

- **Generacja: `claude-opus-4-8`** — najlepsza polszczyzna prawnicza, pilnuje
  19-sekcyjnej struktury i zasad anty-halucynacyjnych. Treść YMYL → jakość > koszt.
- **Triage: `claude-sonnet-4-6`** — tańszy, do masowej oceny/klasyfikacji. To
  świadomy kompromis koszt/wolumen; ustaw `LEXINE_MODEL_TRIAGE=claude-opus-4-8`
  jeśli chcesz maks. trafność.
- **Twoje prompty były pisane pod `claude-opus-4-7` i `temperature 0.4–0.6`.**
  Zaktualizowane: opus‑4‑8 jest aktualny, a na opus‑4‑8/4‑7 **`temperature` jest
  usunięte** (zwraca 400). Determinizm i „nie zmyślaj dat" osiągamy **promptem +
  structured output + web_search grounding**, nie temperaturą. Używamy
  `thinking: adaptive`.

Modele nadpiszesz w `.env` (`LEXINE_MODEL_*`) lub `src/lexine/config.py`.

## Jak pilnujemy braku halucynacji

1. **Grounding** — `research.py` najpierw wyszukuje realne źródła (`web_search`);
   model pisze z dostarczonego kontekstu, nie z pamięci.
2. **Placeholdery** — czego nie ma w danych, model oznacza `{{DO_WERYFIKACJI: ...}}`.
3. **Blok weryfikacji** — każdy draft kończy się listą dat/numerów/cytatów do
   sprawdzenia; `verify.py` zbiera je do `.json`.
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
