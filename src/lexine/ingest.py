"""Ingestion aktów z Dziennika Ustaw przez oficjalne API ELI Sejmu RP.

API: https://api.sejm.gov.pl/eli  (darmowe, bez klucza)
  - GET /acts/DU/{rok}            -> lista pozycji danego rocznika
  - GET /acts/DU/{rok}/{pos}      -> szczegóły aktu (daty, słowa kluczowe)
  - GET /acts/DU/{rok}/{pos}/text.html -> tekst aktu (jeśli dostępny)
"""

from __future__ import annotations

import datetime as dt

import httpx

from .config import ELI_BASE
from .models import Act

_TIMEOUT = httpx.Timeout(30.0)
_HEADERS = {"Accept": "application/json", "User-Agent": "lexine-pipeline/0.1"}


def _normalize(raw: dict, year: int) -> Act:
    return Act(
        eli=raw.get("ELI", f"DU/{year}/{raw.get('pos', '?')}"),
        year=int(raw.get("year", year)),
        pos=int(raw["pos"]),
        title=raw.get("title", "").strip(),
        announcement_date=raw.get("announcementDate") or raw.get("promulgation"),
        entry_into_force=raw.get("entryIntoForce"),
        act_type=raw.get("type"),
        keywords=raw.get("keywords", []) or [],
        status=raw.get("status"),
    )


def list_acts(year: int, *, since: str | None = None, limit: int | None = None) -> list[Act]:
    """Pobiera akty z rocznika Dz.U. Opcjonalnie tylko ogłoszone od daty `since` (YYYY-MM-DD)."""
    url = f"{ELI_BASE}/acts/DU/{year}"
    with httpx.Client(timeout=_TIMEOUT, headers=_HEADERS) as client:
        resp = client.get(url)
        resp.raise_for_status()
        items = resp.json().get("items", [])

    acts: list[Act] = []
    since_d = dt.date.fromisoformat(since) if since else None
    for raw in items:
        try:
            act = _normalize(raw, year)
        except (KeyError, ValueError):
            continue
        if since_d and act.announcement_date:
            try:
                if dt.date.fromisoformat(act.announcement_date) < since_d:
                    continue
            except ValueError:
                pass
        acts.append(act)

    acts.sort(key=lambda a: a.pos, reverse=True)
    return acts[:limit] if limit else acts


def fetch_details(act: Act) -> Act:
    """Dociąga pełne szczegóły pojedynczego aktu (daty, słowa kluczowe)."""
    url = f"{ELI_BASE}/acts/DU/{act.year}/{act.pos}"
    with httpx.Client(timeout=_TIMEOUT, headers=_HEADERS) as client:
        resp = client.get(url)
        resp.raise_for_status()
        return _normalize(resp.json(), act.year)


def fetch_text(act: Act, *, max_chars: int = 40000) -> str:
    """Pobiera tekst aktu (HTML) jako surowy string, przycięty do `max_chars`.

    Zwraca pusty string, jeśli tekst nie jest dostępny (część aktów ma tylko PDF/skan).
    """
    url = f"{ELI_BASE}/acts/DU/{act.year}/{act.pos}/text.html"
    try:
        with httpx.Client(timeout=_TIMEOUT, headers={"User-Agent": _HEADERS["User-Agent"]}) as client:
            resp = client.get(url)
            if resp.status_code != 200:
                return ""
            return resp.text[:max_chars]
    except httpx.HTTPError:
        return ""
