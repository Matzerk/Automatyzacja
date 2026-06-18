"""Research — zbiera źródła i komentarze eksperckie przez web_search.

To kluczowy krok anty-halucynacyjny: zamiast pozwolić modelowi zmyślać daty/cytaty,
najpierw wyszukujemy realne informacje (Prawo.pl, GazetaPrawna, RP, Infor, ISAP) i
dopiero ten zweryfikowany kontekst trafia do generacji. web_search_20260209 jest
serwerowy — Anthropic wykonuje wyszukiwania, my tylko odczytujemy wynik.
"""

from __future__ import annotations

import re

from .client import get_client
from .config import MAX_TOKENS_RESEARCH, MODEL_RESEARCH
from .models import Act, ResearchBrief
from .triage import TriageResult

_SYSTEM = """Jesteś researcherem prawnym. Dla podanego aktu z Dziennika Ustaw zbierasz \
zweryfikowane informacje, korzystając z web_search. Preferowane źródła (kolejność wagi): \
isap.sejm.gov.pl, dziennikustaw.gov.pl, prawo.pl, gazetaprawna.pl, rp.pl, infor.pl, gov.pl, \
newslettery kancelarii (Grant Thornton, Deloitte Legal, DZP, KPMG).

ZASADY:
- Podawaj TYLKO informacje znalezione w źródłach. Niczego nie zmyślaj.
- Cytaty imienne ekspertów dołączaj wyłącznie z atrybucją (autor, portal, data).
- Jeśli czegoś nie znajdziesz, napisz wprost „brak danych".
- Każde źródło w sekcji ŹRÓDŁA podaj z pełnym URL.

Zwróć odpowiedź DOKŁADNIE w tym formacie (z tymi nagłówkami):

### PODSUMOWANIE
<2-4 zdania: czego dotyczy akt, kogo i od kiedy>

### CO ZMIENIA
<konkretne zmiany; jeśli nowelizacja: ustawa zmieniana + numery artykułów + brzmienie przed/po>

### KOMENTARZE EKSPERCKIE
<krótkie cytaty/parafrazy z atrybucją; lub „brak danych">

### POWIAZANE ARTYKULY KODEKSOW
<numery artykułów KK/KPK/KC/KP itd. do podlinkowania; lub „brak">

### ZRODLA
<numerowana lista: tytuł — URL — data>"""

_SECTION_RE = {
    "summary": r"### PODSUMOWANIE\s*(.*?)(?=###|\Z)",
    "what_changes": r"### CO ZMIENIA\s*(.*?)(?=###|\Z)",
    "expert_comments": r"### KOMENTARZE EKSPERCKIE\s*(.*?)(?=###|\Z)",
    "related_codex_articles": r"### POWIAZANE ARTYKULY KODEKSOW\s*(.*?)(?=###|\Z)",
    "sources": r"### ZRODLA\s*(.*?)(?=###|\Z)",
}


def _extract_text(content) -> str:
    return "\n".join(b.text for b in content if getattr(b, "type", None) == "text")


def _parse_brief(text: str) -> ResearchBrief:
    def grab(pattern: str) -> str:
        m = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
        return m.group(1).strip() if m else ""

    brief = ResearchBrief(
        summary=grab(_SECTION_RE["summary"]),
        what_changes=grab(_SECTION_RE["what_changes"]),
        expert_comments=grab(_SECTION_RE["expert_comments"]),
        related_codex_articles=grab(_SECTION_RE["related_codex_articles"]),
        sources=grab(_SECTION_RE["sources"]),
    )
    # Jeśli format się nie sparsował, zachowaj cały tekst w summary (nic nie tracimy).
    if not any(brief.model_dump().values()):
        brief.summary = text.strip()
    return brief


def research_act(act: Act, triage: TriageResult, *, max_continuations: int = 4) -> ResearchBrief:
    client = get_client()
    user = (
        f"Akt: {act.display}\n"
        f"Tytuł: {act.title}\n"
        f"Data ogłoszenia: {act.announcement_date or '—'}\n"
        f"Data wejścia w życie: {act.entry_into_force or '—'}\n"
        f"Kąt artykułu: {triage.angle}\n\n"
        f"Zbierz zweryfikowane informacje i źródła wg formatu z instrukcji."
    )
    messages = [{"role": "user", "content": user}]
    tools = [{"type": "web_search_20260209", "name": "web_search"}]

    response = client.messages.create(
        model=MODEL_RESEARCH,
        max_tokens=MAX_TOKENS_RESEARCH,
        system=_SYSTEM,
        tools=tools,
        messages=messages,
    )
    # web_search jest serwerowy; przy limicie iteracji dostajemy pause_turn → wznawiamy.
    for _ in range(max_continuations):
        if response.stop_reason != "pause_turn":
            break
        messages = [
            {"role": "user", "content": user},
            {"role": "assistant", "content": response.content},
        ]
        response = client.messages.create(
            model=MODEL_RESEARCH,
            max_tokens=MAX_TOKENS_RESEARCH,
            system=_SYSTEM,
            tools=tools,
            messages=messages,
        )

    return _parse_brief(_extract_text(response.content))
