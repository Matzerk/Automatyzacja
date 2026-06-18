"""CLI pipeline'u Lexine.

Przykłady:
  python -m lexine.cli ingest --freshness-days 21            # świeże akty DU+MP
  python -m lexine.cli triage --freshness-days 14            # ocena + routing
  python -m lexine.cli run    --max 3                        # pełny przebieg
  python -m lexine.cli run    --dry-run                      # sama selekcja, bez generacji
"""

from __future__ import annotations

import argparse

from . import ingest, pipeline
from .config import FRESHNESS_DAYS, PUBLISHERS, TRIAGE_THRESHOLD, load_services
from .triage import triage_act


def _cmd_ingest(args) -> None:
    publishers = tuple(args.publishers.split(","))
    acts = ingest.list_recent(
        publishers=publishers, freshness_days=args.freshness_days, limit=args.limit
    )
    print(
        f"Znaleziono {len(acts)} świeżych aktów ({'+'.join(publishers)}, "
        f"ostatnie {args.freshness_days} dni):\n"
    )
    for a in acts:
        print(
            f"  {a.display:>18}  ogł. {a.announcement_date or '—':>10}  "
            f"wejście {a.entry_into_force or '—':>10}  {a.title[:75]}"
        )


def _cmd_triage(args) -> None:
    services = load_services()
    publishers = tuple(args.publishers.split(","))
    acts = ingest.list_recent(
        publishers=publishers, freshness_days=args.freshness_days, limit=args.limit
    )
    print(f"Triage {len(acts)} świeżych aktów (ocena + routing)...\n")
    rows = []
    for a in acts:
        full = ingest.fetch_details(a)
        t = triage_act(full, services)
        rows.append((t.total_score, a, t))
    rows.sort(key=lambda r: r[0], reverse=True)
    for score, a, t in rows:
        flag = "✓" if (t.worth_writing and score >= args.threshold) else "·"
        print(
            f"  {flag} {score:4.1f} (ciekawość {t.layperson_interest}/3)  "
            f"{a.display:>18} → {t.target_service:<22} {t.angle[:55]}"
        )


def _cmd_run(args) -> None:
    report = pipeline.run(
        freshness_days=args.freshness_days,
        publishers=tuple(args.publishers.split(",")),
        scan_limit=args.scan_limit,
        max_articles=args.max,
        threshold=args.threshold,
        dry_run=args.dry_run,
    )
    print("=== RAPORT PRZEBIEGU ===")
    print(f"  Przeskanowano (świeże): {report.scanned}")
    print(f"  Pominięto (już było):   {report.skipped_processed}")
    print(f"  Ocenionych:             {report.triaged}")
    print(f"  Odrzucone (nieciekawe): {report.rejected_uninteresting}")
    print(f"  Wybranych do pisania:   {report.selected}")
    if report.errors:
        print(f"  Błędy (pominięte, ponowią się): {len(report.errors)}")
        for e in report.errors[:5]:
            print(f"    ! {e['act_key']} [{e['stage']}]: {e['error'][:80]}")
        print("    (szczegóły: state/pipeline.log)")
    if report.skipped_cadence:
        print(f"  Pominięto (kadencja): {len(report.skipped_cadence)}")
    print(f"\n  Drafty ({'DRY-RUN' if args.dry_run else 'zapisane do kolejki redakcyjnej'}):")
    for d in report.drafts:
        if args.dry_run:
            print(f"    - {d['act_key']} → {d['service']} (ocena {d['score']:.1f})")
        else:
            print(
                f"    - {d['act_key']} → {d['service']}  "
                f"[recenzja: {d['review_verdict']}, korekt: {len(d['corrections'])}, "
                f"do weryfikacji: {len(d['to_verify'])}]"
            )
            print(
                f"        v1/v2/publikacja + recenzja: "
                f"output/review_queue/{d['service']}/{d['act_key']}.*"
            )
    if not args.dry_run and report.drafts:
        print(
            "\n  Każdy temat: .v1.html → .v2.html (po recenzji) → .publication.html "
            "(bez panelu, do CMS). Wymaga akceptacji redakcji."
        )


def main() -> None:
    p = argparse.ArgumentParser(prog="lexine", description="Pipeline treści prawnych Lexine")
    sub = p.add_subparsers(dest="cmd", required=True)

    def add_source_opts(sp, default_limit):
        sp.add_argument(
            "--freshness-days", type=int, default=FRESHNESS_DAYS, dest="freshness_days",
            help="okno świeżości w dniach (domyślnie 21 = maks. 2–3 tygodnie)",
        )
        sp.add_argument(
            "--publishers", default=",".join(PUBLISHERS),
            help="wydawcy ELI po przecinku: DU,MP",
        )
        sp.add_argument("--limit", type=int, default=default_limit)

    pi = sub.add_parser("ingest", help="Pokaż świeże akty (DU+MP) z okna N dni")
    add_source_opts(pi, 40)
    pi.set_defaults(func=_cmd_ingest)

    pt = sub.add_parser("triage", help="Oceń i zrutuj świeże akty (bez generacji)")
    add_source_opts(pt, 30)
    pt.add_argument("--threshold", type=float, default=TRIAGE_THRESHOLD)
    pt.set_defaults(func=_cmd_triage)

    pr = sub.add_parser("run", help="Pełny przebieg: ingest → ... → kolejka redakcyjna")
    pr.add_argument(
        "--freshness-days", type=int, default=FRESHNESS_DAYS, dest="freshness_days",
        help="okno świeżości w dniach (domyślnie 21)",
    )
    pr.add_argument("--publishers", default=",".join(PUBLISHERS), help="DU,MP")
    pr.add_argument("--scan-limit", type=int, default=150, dest="scan_limit")
    pr.add_argument("--max", type=int, default=5, help="maks. artykułów na przebieg")
    pr.add_argument("--threshold", type=float, default=TRIAGE_THRESHOLD)
    pr.add_argument("--dry-run", action="store_true", help="sama selekcja, bez wywołań generacji")
    pr.set_defaults(func=_cmd_run)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
