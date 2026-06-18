"""Wersja publikacyjna — usuwa panel pipeline (recenzji) z HTML.

Panel `<div class="panel">…</div>` zawiera zagnieżdżone <div>, więc usuwamy go
licząc bilans znaczników (nie naiwnym regexem). CSS panelu zostawiamy — jest
nieszkodliwy bez panelu.
"""

from __future__ import annotations

import re

_PANEL_START = re.compile(r'<div\s+class="panel"\s*>', re.IGNORECASE)
_DIV_TOKEN = re.compile(r"<\s*(/?)div\b[^>]*>", re.IGNORECASE)


def strip_panel(html: str) -> str:
    m = _PANEL_START.search(html)
    if not m:
        return html

    depth = 0
    end = None
    for tok in _DIV_TOKEN.finditer(html, m.start()):
        depth += -1 if tok.group(1) else 1
        if depth == 0:
            end = tok.end()
            break
    if end is None:
        return html  # niezbilansowane — nie ruszamy, wolimy zostawić panel

    cleaned = html[: m.start()] + html[end:]
    # Usuń osierocone puste linie na styku.
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()
