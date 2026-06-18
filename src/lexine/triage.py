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
    return f"""Jesteś redaktorem oceniającym akty z Dziennika Ustaw (DU) i Monitora Polskiego (MP) \
pod kątem treści SEO dla sieci serwisów prawnych Lexine. Dla każdego aktu oceniasz wartość \
tematu i routujesz go do najlepiej dopasowanego serwisu.

KRYTERIUM NADRZĘDNE — CIEKAWE DLA NIE-PRAWNIKA (layperson_interest 0–3):
Czytelnik to ZWYKŁY CZŁOWIEK bez wykształcenia prawniczego. Temat musi go realnie obchodzić: \
dotykać jego portfela, pracy, mieszkania, rodziny, samochodu, zdrowia, podatków, świadczeń. \
0 = nudne/techniczne (obwieszczenia o tekstach jednolitych, sprostowania, akty resortowe, \
rozporządzenia o szczegółach administracyjnych, akty MP typu nominacje, komunikaty, uchwały \
bez wpływu na obywatela). 3 = każdy by kliknął („nowe kary", „wyższe świadczenie", „zmiana \
od kiedy", „nowy obowiązek"). UWAGA: Monitor Polski zawiera DUŻO aktów technicznych — bądź \
surowy. Jeśli przeciętny człowiek wzruszyłby ramionami, to layperson_interest <= 1.

POZOSTAŁE KRYTERIA (waga malejąco):
1. Szeroka grupa odbiorców (broad_audience 0–3): pracownicy, przedsiębiorcy, rodzice, \
kierowcy, właściciele nieruchomości, podatnicy.
2. Ustawa kodeksowa (is_codex): KC, KK, KPK, KPC, Kodeks pracy, Kodeks drogowy, \
Ordynacja podatkowa — podnosi wagę.
3. Timing (timing_days): dni do wejścia w życie; null jeśli nieznane.
Dodatkowo: medialnosc (trend: drony, AI, KSeF, płaca minimalna, podatek Belki), \
practical (czy zwykły człowiek coś z tego wyciągnie), clickable (czy nagłówek chwyci).

total_score: 0–10, ważona ocena całości — z DOMINUJĄCYM udziałem layperson_interest. \
worth_writing: true TYLKO gdy temat jest naprawdę ciekawy dla nie-prawnika \
(layperson_interest >= 2) i total_score >= 6. Akty czysto techniczne/administracyjne \
oceniaj nisko i worth_writing=false — nawet jeśli formalnie dotyczą wielu osób.

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
