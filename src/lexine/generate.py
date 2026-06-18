"""Generacja artykułu v1 w docelowym formacie (jak artykuły wzorcowe).

System prompt = wytyczne formatu + ZAŁĄCZONE artykuły wzorcowe (żeby nowe teksty
były „podobne do już istniejących"). Stała część jest cache'owana → tani wsad.
opus-4-8, streaming, thinking adaptive, bez temperature (usunięte na 4.8).
"""

from __future__ import annotations

import functools

from .client import get_client
from .config import (
    MAX_TOKENS_GENERATE,
    MODEL_GENERATE,
    load_style_examples,
    read_prompt,
)
from .models import Act, ResearchBrief
from .triage import TriageResult

_USER_TEMPLATE = read_prompt("user_template.txt")


@functools.lru_cache(maxsize=1)
def _system_blocks() -> list[dict]:
    instr = read_prompt("system_generator.txt")
    examples = load_style_examples()
    text = instr
    if examples:
        text += "\n\n# ARTYKUŁY WZORCOWE (naśladuj format, styl, CSS i CTA):\n\n" + examples
    return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]


def build_user_message(
    act: Act, triage: TriageResult, brief: ResearchBrief, act_text: str = ""
) -> str:
    return _USER_TEMPLATE.format(
        rok=act.year,
        numer=act.pos,
        tytul=act.title,
        data_ogloszenia=act.announcement_date or "{{DO_WERYFIKACJI: data ogłoszenia}}",
        data_wejscia=act.entry_into_force or "{{DO_WERYFIKACJI: data wejścia w życie}}",
        serwis=triage.target_service,
        kategoria=triage.category,
        kat=triage.angle,
        tresc_aktu=act_text.strip() or "(pełny tekst aktu niedostępny — opieraj się na sekcjach research)",
        kontekst_zmiany=brief.what_changes or "{{DO_WERYFIKACJI: co zmienia akt}}",
        komentarze=brief.expert_comments or "brak danych — użyj formuł bezosobowych",
        uzasadnienie=brief.summary or "{{DO_WERYFIKACJI: uzasadnienie projektu}}",
        powiazane=brief.related_codex_articles or "brak",
    )


def generate_article(
    act: Act, triage: TriageResult, brief: ResearchBrief, act_text: str = ""
) -> str:
    """Zwraca surowy output v1: pełny HTML (z panelem wstępnym) + blok 'DO WERYFIKACJI'."""
    client = get_client()
    user = build_user_message(act, triage, brief, act_text)

    with client.messages.stream(
        model=MODEL_GENERATE,
        max_tokens=MAX_TOKENS_GENERATE,
        thinking={"type": "adaptive"},
        system=_system_blocks(),
        messages=[{"role": "user", "content": user}],
    ) as stream:
        message = stream.get_final_message()

    return "".join(b.text for b in message.content if b.type == "text")
