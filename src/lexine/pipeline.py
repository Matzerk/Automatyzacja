"""Orkiestracja: ingest → triage → (cadence) → research → generate → verify → kolejka.

Reguły:
- idempotencja: akt raz przerobiony nie wraca (manifest),
- jakość: tylko worth_writing i total_score >= TRIAGE_THRESHOLD,
- priorytet eporada24 i rzadsza kadencja serwisów niszowych (cadence_days),
- nic nie jest publikowane — drafty lądują w output/review_queue/<serwis>/ do akceptacji redakcji.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

from . import ingest
from .config import OUTPUT_DIR, TRIAGE_THRESHOLD, load_services
from .generate import generate_article
from .models import Act, TriageResult
from .research import research_act
from .state import Manifest
from .triage import triage_act
from .verify import VerifiedArticle, split_output

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


def _save_draft(act: Act, triage: TriageResult, article: VerifiedArticle) -> dict:
    service_dir = REVIEW_QUEUE / triage.target_service
    service_dir.mkdir(parents=True, exist_ok=True)
    html_path = service_dir / f"{act.key}.html"
    meta_path = service_dir / f"{act.key}.json"

    html_path.write_text(article.html, encoding="utf-8")
    meta = {
        "act_key": act.key,
        "display": act.display,
        "title": act.title,
        "service": triage.target_service,
        "category": triage.category,
        "angle": triage.angle,
        "score": triage.total_score,
        "entry_into_force": act.entry_into_force,
        "needs_review_count": article.needs_review_count,
        "review_block": article.review_block,
        "placeholders": article.placeholders,
        "status": "DO_AKCEPTACJI_REDAKCJI",
        "html_file": html_path.name,
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
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

    # 1) Triage wszystkich świeżych aktów.
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
        # W jednym przebiegu max 1 draft na serwis + globalna kadencja z manifestu.
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
            used_services.add(svc.name)
            produced += 1
            continue

        act_text = ingest.fetch_text(cand.act)
        brief = research_act(cand.act, cand.triage)
        raw = generate_article(cand.act, cand.triage, brief, act_text)
        article = split_output(raw)
        meta = _save_draft(cand.act, cand.triage, article)

        manifest.record_publish(svc.name)
        used_services.add(svc.name)
        report.drafts.append(meta)
        produced += 1

    if not dry_run:
        manifest.save()
    return report
