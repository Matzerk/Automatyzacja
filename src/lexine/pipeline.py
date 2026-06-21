"""Orkiestracja pełnego przepływu:

  ingest (DU+MP, świeże) → triage+routing → research → generacja v1
  → recenzja (inny model + web_search) → wersja v2 → wersja publikacyjna (bez panelu)

Reguły: idempotencja + jakość + „ciekawe dla nie-prawnika" + kadencja per serwis.
Odporność: każdy temat w izolacji (błąd jednego nie wywraca przebiegu), stan
zapisywany przyrostowo, akty z błędem ponawiane do MAX_RETRIES. Nic nie jest
publikowane automatycznie — artefakty trafiają do kolejki redakcyjnej.

Źródła: na razie Dz.U. + Monitor Polski (ELI). Warstwa `ingest` wydzielona pod
kolejne źródła (proces legislacyjny Sejmu, RCL, orzecznictwo, RSS).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

from . import ingest
from .config import (
    FRESHNESS_DAYS,
    MAX_RETRIES,
    MIN_LAYPERSON_INTEREST,
    OUTPUT_DIR,
    PUBLISHERS,
    REVIEW_ROUNDS,
    STATE_DIR,
    TRIAGE_THRESHOLD,
    load_services,
)
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

logger = logging.getLogger("lexine")


def _setup_logging() -> None:
    if logger.handlers:
        return
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    logger.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    fh = logging.FileHandler(STATE_DIR / "pipeline.log", encoding="utf-8")
    fh.setFormatter(fmt)
    logger.addHandler(fh)


@dataclass
class Candidate:
    act: Act
    triage: TriageResult


@dataclass
class RunReport:
    scanned: int = 0
    skipped_processed: int = 0
    triaged: int = 0
    rejected_uninteresting: int = 0
    selected: int = 0
    skipped_cadence: list[str] = field(default_factory=list)
    drafts: list[dict] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)


def _produce(act: Act, triage: TriageResult) -> dict:
    """Pełny cykl jednego artykułu: research → v1 → recenzja → v2 → publikacja."""
    act_text = ingest.fetch_text(act)
    brief = research_act(act, triage)

    html_v1 = split_output(generate_article(act, triage, brief, act_text)).html

    current_html = html_v1
    review: ReviewResult | None = None
    # revise zwraca v2 RAZEM z briefem graficznym (ten sam krok co poprawki)
    final = split_output(html_v1)
    for _ in range(max(1, REVIEW_ROUNDS)):
        review = review_article(act, current_html)
        final = split_output(revise_article(act, triage, current_html, review))
        if review.approved and not review.has_critical:
            break
        current_html = final.html

    html_v2 = final.html
    publication = strip_panel(html_v2)
    graphic_brief = final.graphic_brief

    service_dir = REVIEW_QUEUE / triage.target_service
    service_dir.mkdir(parents=True, exist_ok=True)
    (service_dir / f"{act.key}.v1.html").write_text(html_v1, encoding="utf-8")
    (service_dir / f"{act.key}.v2.html").write_text(html_v2, encoding="utf-8")
    (service_dir / f"{act.key}.publication.html").write_text(publication, encoding="utf-8")
    if review:
        (service_dir / f"{act.key}.review.txt").write_text(review.raw, encoding="utf-8")
    if graphic_brief:
        (service_dir / f"{act.key}.grafika.txt").write_text(graphic_brief, encoding="utf-8")

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
        "to_verify": (review.to_verify if review else [])
        + final.placeholders
        + ([] if graphic_brief else ["Brak briefu graficznego — dorobić ręcznie."]),
        "placeholders_left": final.placeholders,
        "has_graphic_brief": bool(graphic_brief),
        "status": "DO_AKCEPTACJI_REDAKCJI",
        "files": {
            "v1": f"{act.key}.v1.html",
            "v2": f"{act.key}.v2.html",
            "publication": f"{act.key}.publication.html",
            "review": f"{act.key}.review.txt",
            "grafika": f"{act.key}.grafika.txt" if graphic_brief else None,
        },
    }
    (service_dir / f"{act.key}.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return meta


def run(
    *,
    freshness_days: int = FRESHNESS_DAYS,
    publishers: tuple[str, ...] = PUBLISHERS,
    scan_limit: int | None = 150,
    max_articles: int = 5,
    threshold: float = TRIAGE_THRESHOLD,
    min_layperson: int = MIN_LAYPERSON_INTEREST,
    max_retries: int = MAX_RETRIES,
    dry_run: bool = False,
) -> RunReport:
    _setup_logging()
    services = load_services()
    manifest = Manifest()
    report = RunReport()
    logger.info("=== START run (świeżość=%sd, wydawcy=%s) ===", freshness_days, publishers)

    acts = ingest.list_recent(
        publishers=publishers, freshness_days=freshness_days, limit=scan_limit
    )
    report.scanned = len(acts)

    # 1) Triage + routing — każdy akt w izolacji; stan zapisywany na bieżąco.
    candidates: list[Candidate] = []
    for act in acts:
        if manifest.should_skip(act.key, max_retries):
            report.skipped_processed += 1
            continue
        try:
            full = ingest.fetch_details(act)
            triage = triage_act(full, services)
        except Exception as exc:  # błąd ingestu/oceny — ponów następnym razem
            logger.exception("Triage failed for %s", act.key)
            report.errors.append({"act_key": act.key, "stage": "triage", "error": str(exc)})
            if not dry_run:
                manifest.set_failed(act.key, exc, stage="triage")
                manifest.save()
            continue

        report.triaged += 1
        if not (triage.worth_writing and triage.total_score >= threshold):
            if not dry_run:
                manifest.set_skip(act.key, score=triage.total_score, reason="poniżej progu")
                manifest.save()
            continue
        if triage.layperson_interest < min_layperson:
            report.rejected_uninteresting += 1
            if not dry_run:
                manifest.set_skip(act.key, score=triage.total_score, reason="nieciekawe dla nie-prawnika")
                manifest.save()
            continue
        candidates.append(Candidate(full, triage))

    # 2) Najlepsze najpierw; eporada24 (tier 1) z lekkim priorytetem przy remisie.
    candidates.sort(
        key=lambda c: (c.triage.total_score, services[c.triage.target_service].tier == 1),
        reverse=True,
    )

    # 3) Produkcja z poszanowaniem kadencji i limitu; błąd jednego tematu nie przerywa reszty.
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
        used_services.add(svc.name)
        produced += 1

        if dry_run:
            report.drafts.append(
                {"act_key": cand.act.key, "service": svc.name, "score": cand.triage.total_score}
            )
            continue

        try:
            meta = _produce(cand.act, cand.triage)
        except Exception as exc:  # research/generacja/recenzja jednego tematu padła
            logger.exception("Produce failed for %s", cand.act.key)
            report.errors.append({"act_key": cand.act.key, "stage": "produce", "error": str(exc)})
            manifest.set_failed(cand.act.key, exc, stage="produce", service=svc.name)
            manifest.save()
            continue

        report.drafts.append(meta)
        manifest.set_done(cand.act.key, service=svc.name, score=cand.triage.total_score)
        manifest.record_publish(svc.name)
        manifest.save()  # przyrostowo — awaria nie cofa zrobionej pracy

    logger.info(
        "=== KONIEC run: wybrane=%s, drafty=%s, błędy=%s ===",
        report.selected, len(report.drafts), len(report.errors),
    )
    return report
