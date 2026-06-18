"""Rozdzielenie outputu modelu na HTML + listę 'do weryfikacji przez redakcję'.

Zbiera zarówno blok '--- DO WERYFIKACJI PRZEZ REDAKCJĘ ---', jak i wszystkie
placeholdery {{DO_WERYFIKACJI: ...}} pozostawione w HTML. Nic nie publikuje
automatycznie — wynik trafia do kolejki redakcyjnej.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_PLACEHOLDER_RE = re.compile(r"\{\{\s*DO_WERYFIKACJI\s*:?\s*(.*?)\}\}", re.DOTALL)
_BLOCK_RE = re.compile(
    r"---\s*DO WERYFIKACJI PRZEZ REDAKCJĘ\s*---(.*?)(?:---\s*KONIEC\s*---|\Z)",
    re.DOTALL | re.IGNORECASE,
)


@dataclass
class VerifiedArticle:
    html: str
    review_block: str = ""
    placeholders: list[str] = field(default_factory=list)

    @property
    def needs_review_count(self) -> int:
        return len(self.placeholders) + (1 if self.review_block.strip() else 0)


def split_output(raw: str) -> VerifiedArticle:
    block_match = _BLOCK_RE.search(raw)
    review_block = block_match.group(1).strip() if block_match else ""

    # HTML = wszystko od <!DOCTYPE/<html> do </html> (odcinamy blok weryfikacji).
    html = raw
    if block_match:
        html = raw[: block_match.start()].strip()
    end = html.lower().rfind("</html>")
    if end != -1:
        html = html[: end + len("</html>")]
    start = html.lower().find("<!doctype")
    if start == -1:
        start = html.lower().find("<html")
    if start > 0:
        html = html[start:]

    placeholders = [p.strip() for p in _PLACEHOLDER_RE.findall(raw)]
    return VerifiedArticle(html=html.strip(), review_block=review_block, placeholders=placeholders)
