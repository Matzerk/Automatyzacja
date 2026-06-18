"""Orkiestracja pełnego przepływu:

  ingest (Dz.U.) → triage+routing → research → generacja v1
  → recenzja (inny model + web_search) → wersja v2 → wersja publikacyjna (bez panelu)

Reguły: idempotencja + jakość (próg) + kadencja per serwis (priorytet eporada24).
Nic nie jest publikowane automatycznie — artefakty trafiają do kolejki redakcyjnej.

Źródła: na razie wyłącznie Dziennik Ustaw (API ELI). Warstwa `ingest` jest celowo
wydzielona, więc dołożenie kolejnych źródeł (web_search/RSS/RCL) nie ruszy reszty.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from . import ingest
from .config import OUTPUT_DIR, REVIEW_ROUNDS, TRIAGE_THRESHOLD, load_services
from .generate import generate_article
from .models import Act, ReviewResult, TriageResult
from .publish import strip_panel
from .research import research_act
from .review import review_article
from .revise import revise_article
from .state import Manifest
from .triage import triage_act
from .verify import split_output

REVIEW_QUEUE = OUTPUT_DIR / "review_queue"


@dataclass
class Candidate:
    act: Act
    triage: TriageResult


@dataclass
class RunReport:
    scanned: int = 0
    skipped_processed: int = 0
    triaged: int = 0
    selected: int = 0
    skipped_cadence: list[str] = field(default_factory=list)
    drafts: list[dict] = field(default_factory=list)


def _produce(act: Act, triage: TriageResult) -> dict:
    """Pełny cykl jednego artykułu: research → v1 → recenzja → v2 → publikacja."""
    act_text = ingest.fetch_text(act)
    brief = research_act(act, triage)

    # v1
    html_v1 = split_output(generate_article(act, triage, brief, act_text)).html

    # recenzja → v2 (REVIEW_ROUNDS rund; domyślnie 1)
    current_html = html_v1
    review: ReviewResult | None = None
    html_v2 = html_v1
    for r in range(max(1, REVIEW_ROUNDS)):
        review = review_article(act, current_html)
        html_v2 = split_output(revise_article(act, triage, current_html, review)).html
        if review.approved and not review.has_critical:
            break
        current_html = html_v2  # kolejna runda nanosi na świeższą wersję

    publication = strip_panel(html_v2)
    final = split_output(html_v2)  # placeholdery pozostałe w v2

    service_dir = REVIEW_QUEUE / triage.target_service
    service_dir.mkdir(parents=True, exist_ok=True)
    (service_dir / f"{act.key}.v1.html").write_text(html_v1, encoding="utf-8")
    (service_dir / f"{act.key}.v2.html").write_text(html_v2, encoding="utf-8")
    (service_dir / f"{act.key}.publication.html").write_text(publication, encoding="utf-8")
    if review:
        (service_dir / f"{act.key}.review.txt").write_text(review.raw, encoding="utf-8")

    meta = {
        "act_key": act.key,
        "display": act.display,
        "title": act.title,
        "service": triage.target_service,
        "category": triage.category,
        "angle": triage.angle,
        "score": triage.total_score,
        "entry_into_force": act.entry_into_force,
        "review_verdict": review.verdict if review else None,
        "corrections": review.corrections if review else [],
        "to_verify": (review.to_verify if review else []) + final.placeholders,
        "placeholders_left": final.placeholders,
        "status": "DO_AKCEPTACJI_REDAKCJI",
        "files": {
            "v1": f"{act.key}.v1.html",
            "v2": f"{act.key}.v2.html",
            "publication": f"{act.key}.publication.html",
            "review": f"{act.key}.review.txt",
        },
    }
    (service_dir / f"{act.key}.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return meta


def run(
    year: int,
    *,
    since: str | None = None,
    scan_limit: int | None = 60,
    max_articles: int = 5,
    threshold: float = TRIAGE_THRESHOLD,
    dry_run: bool = False,
) -> RunReport:
    services = load_services()
    manifest = Manifest()
    report = RunReport()

    acts = ingest.list_acts(year, since=since, limit=scan_limit)
    report.scanned = len(acts)

    # 1) Triage + routing każdego świeżego aktu.
    candidates: list[Candidate] = []
    for act in acts:
        if manifest.is_processed(act.key):
            report.skipped_processed += 1
            continue
        full = ingest.fetch_details(act)
        triage = triage_act(full, services)
        report.triaged += 1
        manifest.mark_processed(
            act.key, {"score": triage.total_score, "service": triage.target_service}
        )
        if triage.worth_writing and triage.total_score >= threshold:
            candidates.append(Candidate(full, triage))

    # 2) Najlepsze najpierw; eporada24 (tier 1) z lekkim priorytetem przy remisie.
    candidates.sort(
        key=lambda c: (c.triage.total_score, services[c.triage.target_service].tier == 1),
        reverse=True,
    )

    # 3) Selekcja z poszanowaniem kadencji per serwis i limitu na przebieg.
    produced = 0
    used_services: set[str] = set()
    for cand in candidates:
        if produced >= max_articles:
            break
        svc = services[cand.triage.target_service]
        if cand.triage.target_service in used_services or not manifest.cadence_ok(
            svc.name, svc.cadence_days
        ):
            report.skipped_cadence.append(f"{cand.act.key} → {svc.name}")
            continue

        report.selected += 1
        if dry_run:
            report.drafts.append(
                {"act_key": cand.act.key, "service": svc.name, "score": cand.triage.total_score}
            )
        else:
            report.drafts.append(_produce(cand.act, cand.triage))
            manifest.record_publish(svc.name)

        used_services.add(svc.name)
        produced += 1

    if not dry_run:
        manifest.save()
    return report
