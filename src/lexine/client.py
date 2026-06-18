"""Fabryka klienta Anthropic (czyta ANTHROPIC_API_KEY ze środowiska)."""

from __future__ import annotations

import functools

import anthropic


@functools.lru_cache(maxsize=1)
def get_client() -> anthropic.Anthropic:
    # Klucz rozwiązywany z ANTHROPIC_API_KEY. SDK sam ponawia 429/5xx z backoffem.
    return anthropic.Anthropic(max_retries=4)
