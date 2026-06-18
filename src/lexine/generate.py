"""Generowanie artykułu HTML — opus-4-8, streaming, cache na system prompcie.

System prompt (19-sekcyjna struktura + zasady) jest stały dla wszystkich aktów →
cache_control daje ~90% oszczędności na powtarzanym prefiksie. Streaming, bo artykuł
to 12–18 tys. znaków (duży max_tokens bez ryzyka timeoutu HTTP).
"""

from __future__ import annotations

from .client import get_client
from .config import MAX_TOKENS_GENERATE, MODEL_GENERATE, read_prompt
from .models import Act, ResearchBrief
from .triage import TriageResult

_SYSTEM = read_prompt("system_generator.txt")
_USER_TEMPLATE = read_prompt("user_template.txt")


def _month_pl(date_iso: str | None) -> str:
    return date_iso or "{{DO_WERYFIKACJI: data}}"


def build_user_message(
    act: Act, triage: TriageResult, brief: ResearchBrief, act_text: str = ""
) -> str:
    kontekst = brief.what_changes or "{{DO_WERYFIKACJI: co zmienia akt}}"
    komentarze = brief.expert_comments or "brak danych — użyj formuł bezosobowych"
    uzasadnienie = brief.summary or "{{DO_WERYFIKACJI: uzasadnienie projektu}}"
    powiazane = brief.related_codex_articles or "brak"
    tresc = act_text.strip() or "(pełny tekst aktu niedostępny — opieraj się na sekcjach research)"

    return _USER_TEMPLATE.format(
        rok=act.year,
        numer=act.pos,
        tytul=act.title,
        data_ogloszenia=_month_pl(act.announcement_date),
        data_wejscia=_month_pl(act.entry_into_force),
        serwis=triage.target_service,
        kategoria=triage.category,
        kat=triage.angle,
        tresc_aktu=tresc,
        kontekst_zmiany=kontekst,
        komentarze=komentarze,
        uzasadnienie=uzasadnienie,
        powiazane=powiazane,
    )


def generate_article(
    act: Act, triage: TriageResult, brief: ResearchBrief, act_text: str = ""
) -> str:
    """Zwraca surowy output modelu: HTML + blok 'DO WERYFIKACJI' na końcu."""
    client = get_client()
    user = build_user_message(act, triage, brief, act_text)

    with client.messages.stream(
        model=MODEL_GENERATE,
        max_tokens=MAX_TOKENS_GENERATE,
        thinking={"type": "adaptive"},  # opus-4-8: brak budget_tokens, brak temperature
        system=[{"type": "text", "text": _SYSTEM, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user}],
    ) as stream:
        message = stream.get_final_message()

    return "".join(b.text for b in message.content if b.type == "text")
