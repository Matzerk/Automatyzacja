"""Modele danych przepływające przez pipeline."""

from __future__ import annotations

from pydantic import BaseModel, Field


class Act(BaseModel):
    """Akt z Dziennika Ustaw (znormalizowany z API ELI Sejmu)."""

    eli: str
    year: int
    pos: int
    title: str
    announcement_date: str | None = None  # data ogłoszenia YYYY-MM-DD
    entry_into_force: str | None = None  # data wejścia w życie YYYY-MM-DD
    act_type: str | None = None
    keywords: list[str] = Field(default_factory=list)
    status: str | None = None

    @property
    def display(self) -> str:
        return f"Dz.U. {self.year} poz. {self.pos}"

    @property
    def key(self) -> str:
        """Stabilny identyfikator (idempotencja / klucz manifestu)."""
        return f"DU-{self.year}-{self.pos}"


class TriageResult(BaseModel):
    """Wynik oceny + routingu aktu (structured output z Claude).

    Schema wysyłana do API nie obsługuje min/max liczb — walidujemy lekko po stronie klienta.
    """

    broad_audience: int = Field(description="Szeroka grupa odbiorców, 0–3")
    is_codex: bool = Field(description="Czy dotyczy ustawy kodeksowej (KC/KK/KPK/KPC/KP/Ordynacja)")
    timing_days: int | None = Field(default=None, description="Dni do wejścia w życie; null jeśli nieznane")
    medialnosc: int = Field(description="Medialność/trend, 0–3")
    practical: int = Field(description="Praktyczność dla zwykłego człowieka, 0–3")
    clickable: int = Field(description="Potencjał klikalności nagłówka, 0–3")
    total_score: float = Field(description="Łączna ocena 0–10")
    worth_writing: bool = Field(description="Czy temat jest wart artykułu")
    target_service: str = Field(description="Domena serwisu docelowego, np. prawo-karne.info")
    category: str = Field(description="Kategoria w breadcrumbs")
    angle: str = Field(description="Sugerowany kąt artykułu, 1 zdanie")
    rationale: str = Field(description="2–3 zdania uzasadnienia")


class ResearchBrief(BaseModel):
    """Zebrany kontekst pod generację (z web_search, z atrybucją źródeł)."""

    summary: str = ""
    what_changes: str = ""
    expert_comments: str = ""
    sources: str = ""
    related_codex_articles: str = ""
