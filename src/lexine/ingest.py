"""Ingestion aktów z Dziennika Ustaw (DU) i Monitora Polskiego (MP) przez API ELI Sejmu.

API: https://api.sejm.gov.pl/eli  (darmowe, bez klucza)
  - GET /acts/{DU|MP}/{rok}            -> lista pozycji rocznika
  - GET /acts/{DU|MP}/{rok}/{pos}      -> szczegóły aktu (daty, słowa kluczowe)
  - GET /acts/{DU|MP}/{rok}/{pos}/text.html -> tekst (jeśli dostępny)

Treści mają być świeże — `list_recent` ogranicza się do aktów ogłoszonych w
oknie ostatnich N dni (domyślnie 21 = maks. 2–3 tygodnie).
"""

from __future__ import annotations

import datetime as dt

import httpx

from .config import ELI_BASE
from .models import Act

_TIMEOUT = httpx.Timeout(30.0)
_HEADERS = {"Accept": "application/json", "User-Agent": "lexine-pipeline/0.1"}


def _normalize(raw: dict, year: int, publisher: str) -> Act:
    return Act(
        publisher=publisher,
        eli=raw.get("ELI", f"{publisher}/{year}/{raw.get('pos', '?')}"),
        year=int(raw.get("year", year)),
        pos=int(raw["pos"]),
        title=raw.get("title", "").strip(),
        announcement_date=raw.get("announcementDate") or raw.get("promulgation"),
        entry_into_force=raw.get("entryIntoForce"),
        act_type=raw.get("type"),
        keywords=raw.get("keywords", []) or [],
        status=raw.get("status"),
    )


def _parse_date(value: str | None) -> dt.date | None:
    if not value:
        return None
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        return None


def list_acts(
    year: int, *, publisher: str = "DU", since: str | None = None, limit: int | None = None
) -> list[Act]:
    """Akty jednego rocznika danego publishera (DU/MP). `since` filtruje po dacie ogłoszenia."""
    url = f"{ELI_BASE}/acts/{publisher}/{year}"
    with httpx.Client(timeout=_TIMEOUT, headers=_HEADERS) as client:
        resp = client.get(url)
        resp.raise_for_status()
        items = resp.json().get("items", [])

    since_d = _parse_date(since)
    acts: list[Act] = []
    for raw in items:
        try:
            act = _normalize(raw, year, publisher)
        except (KeyError, ValueError):
            continue
        ann = _parse_date(act.announcement_date)
        if since_d and ann and ann < since_d:
            continue
        acts.append(act)

    acts.sort(key=lambda a: a.pos, reverse=True)
    return acts[:limit] if limit else acts


def list_recent(
    *,
    publishers: tuple[str, ...] = ("DU", "MP"),
    freshness_days: int = 21,
    limit: int | None = None,
) -> list[Act]:
    """Świeże akty (DU+MP) ogłoszone w ostatnich `freshness_days` dniach, najnowsze pierwsze.

    Obsługuje przełom roku (gdy okno sięga poprzedniego rocznika).
    """
    today = dt.date.today()
    cutoff = today - dt.timedelta(days=freshness_days)
    years = sorted({cutoff.year, today.year})

    acts: dict[str, Act] = {}
    for pub in publishers:
        for yr in years:
            try:
                for act in list_acts(yr, publisher=pub, since=cutoff.isoformat()):
                    acts[act.key] = act
            except httpx.HTTPError:
                continue  # brak rocznika dla publishera → pomiń

    ordered = sorted(
        acts.values(),
        key=lambda a: _parse_date(a.announcement_date) or dt.date.min,
        reverse=True,
    )
    return ordered[:limit] if limit else ordered


def fetch_details(act: Act) -> Act:
    """Dociąga pełne szczegóły aktu (daty, słowa kluczowe)."""
    url = f"{ELI_BASE}/acts/{act.publisher}/{act.year}/{act.pos}"
    with httpx.Client(timeout=_TIMEOUT, headers=_HEADERS) as client:
        resp = client.get(url)
        resp.raise_for_status()
        return _normalize(resp.json(), act.year, act.publisher)


def fetch_text(act: Act, *, max_chars: int = 40000) -> str:
    """Tekst aktu (HTML) przycięty do `max_chars`. Pusty string, gdy niedostępny."""
    url = f"{ELI_BASE}/acts/{act.publisher}/{act.year}/{act.pos}/text.html"
    try:
        with httpx.Client(timeout=_TIMEOUT, headers={"User-Agent": _HEADERS["User-Agent"]}) as client:
            resp = client.get(url)
            return resp.text[:max_chars] if resp.status_code == 200 else ""
    except httpx.HTTPError:
        return ""
