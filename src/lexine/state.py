"""Trwały stan pipeline'u: idempotencja + kadencja per serwis.

state/manifest.json:
  processed:  {act_key: {...}}            — co już przerobiono (anty-duplikat)
  last_published: {service: "YYYY-MM-DD"} — kiedy ostatnio powstał draft na serwis
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

from .config import STATE_DIR

_MANIFEST = STATE_DIR / "manifest.json"


class Manifest:
    def __init__(self) -> None:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        if _MANIFEST.exists():
            self.data = json.loads(_MANIFEST.read_text(encoding="utf-8"))
        else:
            self.data = {"processed": {}, "last_published": {}}

    def is_processed(self, act_key: str) -> bool:
        return act_key in self.data["processed"]

    def mark_processed(self, act_key: str, meta: dict) -> None:
        self.data["processed"][act_key] = meta

    def days_since_last(self, service: str) -> int | None:
        last = self.data["last_published"].get(service)
        if not last:
            return None
        try:
            return (dt.date.today() - dt.date.fromisoformat(last)).days
        except ValueError:
            return None

    def cadence_ok(self, service: str, cadence_days: int) -> bool:
        d = self.days_since_last(service)
        return d is None or d >= cadence_days

    def record_publish(self, service: str) -> None:
        self.data["last_published"][service] = dt.date.today().isoformat()

    def save(self) -> None:
        _MANIFEST.write_text(
            json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
