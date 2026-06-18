"""Wersja v2 — nanosi uwagi recenzenta na artykuł v1 i aktualizuje panel.

Używa tych samych artykułów wzorcowych co generator (spójność formatu) + dodatkowej
instrukcji 'reviser'. opus-4-8, streaming.
"""

from __future__ import annotations

from .client import get_client
from .config import MAX_TOKENS_REVISE, MODEL_REVISE, load_style_examples, read_prompt
from .models import Act, ReviewResult
from .triage import TriageResult


def _system_blocks() -> list[dict]:
    reviser = read_prompt("system_reviser.txt")
    examples = load_style_examples()
    text = reviser
    if examples:
        text += "\n\n# ARTYKUŁY WZORCOWE (zachowaj ten format/styl):\n\n" + examples
    return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]


def revise_article(
    act: Act, triage: TriageResult, html_v1: str, review: ReviewResult
) -> str:
    client = get_client()
    user = (
        f"Serwis: {triage.target_service}\n"
        f"Akt: {act.display} — {act.title}\n\n"
        f"=== UWAGI RECENZENTA ===\n{review.raw}\n\n"
        f"=== ARTYKUŁ v1 (HTML do poprawienia) ===\n{html_v1}\n\n"
        f"Wygeneruj kompletny HTML v2 z naniesionymi poprawkami i zaktualizowanym panelem."
    )
    with client.messages.stream(
        model=MODEL_REVISE,
        max_tokens=MAX_TOKENS_REVISE,
        thinking={"type": "adaptive"},
        system=_system_blocks(),
        messages=[{"role": "user", "content": user}],
    ) as stream:
        message = stream.get_final_message()

    return "".join(b.text for b in message.content if b.type == "text")
