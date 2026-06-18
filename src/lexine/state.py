"""Trwały stan pipeline'u: statusy aktów + kadencja per serwis.

state/manifest.json:
  acts: {act_key: {status, attempts, score, service, triage?, error?, updated}}
        status ∈ skip (nieciekawy/odrzucony) | done (wyprodukowany) | failed (błąd)
  last_published: {service: "YYYY-MM-DD"}

Idempotencja: akt `skip`/`done` nie wraca; `failed` ponawiamy do MAX_RETRIES.
Stan zapisujemy PRZYROSTOWO (po każdym akcie), więc awaria nie gubi postępu.
"""

from __future__ import annotations

import datetime as dt
import json

from .config import STATE_DIR

_MANIFEST = STATE_DIR / "manifest.json"


class Manifest:
    def __init__(self) -> None:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        if _MANIFEST.exists():
            self.data = json.loads(_MANIFEST.read_text(encoding="utf-8"))
        else:
            self.data = {}
        self.data.setdefault("acts", {})
        self.data.setdefault("last_published", {})

    # --- statusy aktów ---
    def get(self, act_key: str) -> dict | None:
        return self.data["acts"].get(act_key)

    def should_skip(self, act_key: str, max_retries: int) -> bool:
        rec = self.get(act_key)
        if not rec:
            return False
        if rec["status"] in ("skip", "done"):
            return True
        return rec["status"] == "failed" and rec.get("attempts", 0) >= max_retries

    def _set(self, act_key: str, status: str, **info) -> None:
        rec = {"status": status, "updated": dt.date.today().isoformat(), **info}
        self.data["acts"][act_key] = rec

    def set_skip(self, act_key: str, **info) -> None:
        self._set(act_key, "skip", **info)

    def set_done(self, act_key: str, **info) -> None:
        self._set(act_key, "done", **info)

    def set_failed(self, act_key: str, error: str, **info) -> None:
        attempts = (self.get(act_key) or {}).get("attempts", 0) + 1
        self._set(act_key, "failed", attempts=attempts, error=str(error)[:500], **info)

    # --- kadencja ---
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
