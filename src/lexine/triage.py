"""Ocena tematu + routing do serwisu — jeden structured-output call na akt.

Kryteria (waga malejąco): szeroka grupa > kodeks > timing 30–90 dni,
plus medialność / praktyczność / klikalność. System prompt (rubryka + katalog
19 serwisów) jest stały → cache'owany, więc masowy triage jest tani.
"""

from __future__ import annotations

from .client import get_client
from .config import MAX_TOKENS_TRIAGE, MODEL_TRIAGE, Service
from .models import Act, TriageResult


def _system_prompt(services: dict[str, Service]) -> str:
    katalog = "\n".join(
        f"- {s.name} (kat: {s.category}; dziedziny: {', '.join(s.domains)})"
        for s in services.values()
    )
    return f"""Jesteś redaktorem oceniającym akty z Dziennika Ustaw pod kątem treści SEO \
dla sieci serwisów prawnych Lexine. Dla każdego aktu oceniasz wartość tematu i routujesz \
go do najlepiej dopasowanego serwisu.

KRYTERIA OCENY (waga malejąco — najważniejsze pierwsze):
1. Szeroka grupa odbiorców (broad_audience 0–3): pracownicy, przedsiębiorcy, rodzice, \
kierowcy, właściciele nieruchomości, podatnicy. Im więcej osób, tym wyżej.
2. Ustawa kodeksowa (is_codex): KC, KK, KPK, KPC, Kodeks pracy, Kodeks drogowy, \
Ordynacja podatkowa — automatycznie podnosi wagę.
3. Timing (timing_days): liczba dni do wejścia w życie. Okno 30–90 dni jest najlepsze \
(świeże, ale jest czas się przygotować). Podaj null, jeśli nieznane.
Dodatkowo: medialnosc (trend: drony, AI, KSeF, płaca minimalna, podatek Belki), \
practical (czy zwykły człowiek coś z tego wyciągnie), clickable (czy nagłówek chwyci: \
kary więzienia, nowe obowiązki, nowe kary finansowe).

total_score: 0–10, ważona ocena całości. worth_writing: true jeśli total_score wystarcza \
na wartościowy artykuł (zwykle >= 6). Akty czysto techniczne (sprostowania, obwieszczenia \
o tekstach jednolitych bez zmian merytorycznych, rozporządzenia resortowe bez wpływu na \
zwykłego obywatela) oceniaj nisko i worth_writing=false.

ROUTING — wybierz target_service z DOKŁADNIE tej listy (pole target_service musi być jedną \
z tych domen). Gdy temat ogólny / dotyczy wielu dziedzin → eporada24.pl. Gdy wyraźnie \
niszowy → odpowiedni serwis specjalistyczny. category ustaw zgodnie z katalogiem.

KATALOG SERWISÓW:
{katalog}

Zwróć ocenę zgodną ze schematem. angle: jednozdaniowy kąt artykułu (jakie pytanie zadać \
czytelnikowi). rationale: 2–3 zdania uzasadnienia."""


def _user_prompt(act: Act) -> str:
    kw = ", ".join(act.keywords) if act.keywords else "—"
    return (
        f"Oceń ten akt:\n"
        f"Pozycja: {act.display}\n"
        f"Tytuł: {act.title}\n"
        f"Typ: {act.act_type or '—'}\n"
        f"Data ogłoszenia: {act.announcement_date or '—'}\n"
        f"Data wejścia w życie: {act.entry_into_force or '—'}\n"
        f"Słowa kluczowe: {kw}"
    )


def triage_act(act: Act, services: dict[str, Service]) -> TriageResult:
    client = get_client()
    response = client.messages.parse(
        model=MODEL_TRIAGE,
        max_tokens=MAX_TOKENS_TRIAGE,
        system=[
            {
                "type": "text",
                "text": _system_prompt(services),
                "cache_control": {"type": "ephemeral"},  # stała rubryka → cache
            }
        ],
        messages=[{"role": "user", "content": _user_prompt(act)}],
        output_format=TriageResult,
    )
    result = response.parsed_output

    # Twarda walidacja routingu: model musi trafić w jeden z 19 serwisów,
    # inaczej fallback na flagowy eporada24.pl.
    if result.target_service not in services:
        result.target_service = "eporada24.pl"
        result.category = services["eporada24.pl"].category
    return result
