"""Konfiguracja: modele, ścieżki, katalog serwisów."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parents[2]
PROMPTS_DIR = ROOT / "prompts"
CONFIG_DIR = ROOT / "config"
OUTPUT_DIR = ROOT / "output"
STATE_DIR = ROOT / "state"

# --- Modele Claude ---------------------------------------------------------
# Generowanie: opus-4-8 — najlepsza polszczyzna prawnicza, pilnuje 19-sekcyjnej
#   struktury i zasad anty-halucynacyjnych. To treść YMYL, jakość > koszt.
# Triage: sonnet-4-6 — tańszy, dobry do masowej klasyfikacji/oceny wielu aktów.
#   Świadomy kompromis koszt/wolumen; zmień na opus-4-8 jeśli chcesz maks. trafność.
# UWAGA: na opus-4-8/4-7 parametr `temperature` jest USUNIĘTY (zwraca 400).
#   Determinizm/„nie fantazjuj dat" osiągamy promptem + structured output, nie temperaturą.
MODEL_GENERATE = os.getenv("LEXINE_MODEL_GENERATE", "claude-opus-4-8")
MODEL_TRIAGE = os.getenv("LEXINE_MODEL_TRIAGE", "claude-sonnet-4-6")
MODEL_RESEARCH = os.getenv("LEXINE_MODEL_RESEARCH", "claude-opus-4-8")
# Recenzent ("inny chat") — niezależna weryfikacja merytoryczna + web_search.
MODEL_REVIEW = os.getenv("LEXINE_MODEL_REVIEW", "claude-opus-4-8")
MODEL_REVISE = os.getenv("LEXINE_MODEL_REVISE", "claude-opus-4-8")

# Ile rund recenzja→v2 (1 = pojedyncza pętla v1→recenzja→v2).
REVIEW_ROUNDS = int(os.getenv("LEXINE_REVIEW_ROUNDS", "1"))

# Limity tokenów (artykuł 12–18 tys. znaków → streaming, duży zapas).
MAX_TOKENS_GENERATE = 32000
MAX_TOKENS_TRIAGE = 2000
MAX_TOKENS_RESEARCH = 8000
MAX_TOKENS_REVIEW = 8000
MAX_TOKENS_REVISE = 32000

# Próg jakości tematu (0–10) — poniżej akt nie trafia do produkcji.
TRIAGE_THRESHOLD = 6.0

# Oficjalne API Dziennika Ustaw (ELI, Sejm RP) — darmowe, bez klucza.
ELI_BASE = "https://api.sejm.gov.pl/eli"


@dataclass
class Service:
    name: str
    tier: int
    cadence_days: int
    category: str
    domains: list[str] = field(default_factory=list)


def load_services() -> dict[str, Service]:
    raw = yaml.safe_load((CONFIG_DIR / "services.yaml").read_text(encoding="utf-8"))
    return {
        name: Service(name=name, **data)
        for name, data in raw["services"].items()
    }


def read_prompt(filename: str) -> str:
    return (PROMPTS_DIR / filename).read_text(encoding="utf-8")


def load_style_examples() -> str:
    """Łączy artykuły wzorcowe — przekazywane modelowi jako referencja stylu/formatu."""
    examples_dir = PROMPTS_DIR / "examples"
    if not examples_dir.exists():
        return ""
    parts = []
    for path in sorted(examples_dir.glob("*.html")):
        parts.append(f"--- WZÓR: {path.name} ---\n{path.read_text(encoding='utf-8')}")
    return "\n\n".join(parts)
