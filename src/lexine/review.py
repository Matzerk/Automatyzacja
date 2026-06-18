"""Recenzja merytoryczna ('inny chat') — opus-4-8 + web_search.

Niezależny agent-recenzent czyta gotowy artykuł v1 i weryfikuje fakty/daty/przepisy
w źródłach (ISAP, Dz.U., portale). Zwraca strukturalne uwagi, które krok v2 nanosi.
To druga, niezależna warstwa anty-halucynacyjna (oddzielne wywołanie, oddzielna rola).
"""

from __future__ import annotations

import re

from .client import get_client
from .config import MAX_TOKENS_REVIEW, MODEL_REVIEW, read_prompt
from .models import Act, ReviewResult

_SYSTEM = read_prompt("system_reviewer.txt")

_SECTIONS = {
    "verdict": r"### WERDYKT\s*(.*?)(?=###|\Z)",
    "corrections": r"### KOREKTY_MERYTORYCZNE\s*(.*?)(?=###|\Z)",
    "to_verify": r"### DO_WERYFIKACJI\s*(.*?)(?=###|\Z)",
    "style_notes": r"### UWAGI_STYL\s*(.*?)(?=###|\Z)",
    "sources": r"### ZRODLA_RECENZJI\s*(.*?)(?=###|\Z)",
}


def _bullets(block: str) -> list[str]:
    items = [
        re.sub(r"^[-*]\s*", "", ln).strip()
        for ln in block.splitlines()
        if ln.strip().startswith(("-", "*"))
    ]
    return [i for i in items if i and i.lower() != "brak"]


def _extract_text(content) -> str:
    return "\n".join(b.text for b in content if getattr(b, "type", None) == "text")


def _parse(text: str) -> ReviewResult:
    def grab(key: str) -> str:
        m = re.search(_SECTIONS[key], text, re.DOTALL | re.IGNORECASE)
        return m.group(1).strip() if m else ""

    verdict = "APPROVED" if "APPROVED" in grab("verdict").upper() else "WYMAGA_POPRAWEK"
    return ReviewResult(
        verdict=verdict,
        corrections=_bullets(grab("corrections")),
        to_verify=_bullets(grab("to_verify")),
        style_notes=_bullets(grab("style_notes")),
        sources=_bullets(grab("sources")),
        raw=text.strip(),
    )


def review_article(act: Act, html: str, *, max_continuations: int = 4) -> ReviewResult:
    client = get_client()
    user = (
        f"Zrecenzuj poniższy artykuł v1 dla aktu {act.display} ({act.title}).\n"
        f"Zweryfikuj fakty w źródłach i zwróć uwagi w wymaganym formacie.\n\n"
        f"=== ARTYKUŁ v1 (HTML) ===\n{html}"
    )
    tools = [{"type": "web_search_20260209", "name": "web_search"}]
    messages = [{"role": "user", "content": user}]

    response = client.messages.create(
        model=MODEL_REVIEW,
        max_tokens=MAX_TOKENS_REVIEW,
        system=_SYSTEM,
        tools=tools,
        messages=messages,
    )
    for _ in range(max_continuations):
        if response.stop_reason != "pause_turn":
            break
        messages = [{"role": "user", "content": user}, {"role": "assistant", "content": response.content}]
        response = client.messages.create(
            model=MODEL_REVIEW,
            max_tokens=MAX_TOKENS_REVIEW,
            system=_SYSTEM,
            tools=tools,
            messages=messages,
        )

    return _parse(_extract_text(response.content))
