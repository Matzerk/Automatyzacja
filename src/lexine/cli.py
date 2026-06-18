"""CLI pipeline'u Lexine.

Przykłady:
  python -m lexine.cli ingest --year 2026 --since 2026-05-01 --limit 20
  python -m lexine.cli triage --year 2026 --limit 15
  python -m lexine.cli run    --year 2026 --since 2026-05-01 --max 3
  python -m lexine.cli run    --year 2026 --dry-run        # bez generacji, sama selekcja
"""

from __future__ import annotations

import argparse
import datetime as dt

from . import ingest, pipeline
from .config import load_services
from .triage import triage_act


def _cmd_ingest(args) -> None:
    acts = ingest.list_acts(args.year, since=args.since, limit=args.limit)
    print(f"Znaleziono {len(acts)} aktów (Dz.U. {args.year}):\n")
    for a in acts:
        print(f"  {a.display:>18}  [{a.entry_into_force or '—':>10}]  {a.title[:90]}")


def _cmd_triage(args) -> None:
    services = load_services()
    acts = ingest.list_acts(args.year, since=args.since, limit=args.limit)
    print(f"Triage {len(acts)} aktów (model oceny + routing)...\n")
    rows = []
    for a in acts:
        full = ingest.fetch_details(a)
        t = triage_act(full, services)
        rows.append((t.total_score, a, t))
    rows.sort(key=lambda r: r[0], reverse=True)
    for score, a, t in rows:
        flag = "✓" if (t.worth_writing and score >= args.threshold) else "·"
        print(f"  {flag} {score:4.1f}  {a.display:>18} → {t.target_service:<22} {t.angle[:60]}")


def _cmd_run(args) -> None:
    report = pipeline.run(
        args.year,
        since=args.since,
        scan_limit=args.scan_limit,
        max_articles=args.max,
        threshold=args.threshold,
        dry_run=args.dry_run,
    )
    print("=== RAPORT PRZEBIEGU ===")
    print(f"  Przeskanowano:        {report.scanned}")
    print(f"  Pominięto (już było): {report.skipped_processed}")
    print(f"  Ocenionych:           {report.triaged}")
    print(f"  Wybranych do pisania: {report.selected}")
    if report.skipped_cadence:
        print(f"  Pominięto (kadencja): {len(report.skipped_cadence)}")
    print(f"\n  Drafty ({'DRY-RUN' if args.dry_run else 'zapisane do kolejki redakcyjnej'}):")
    for d in report.drafts:
        if args.dry_run:
            print(f"    - {d['act_key']} → {d['service']} (ocena {d['score']:.1f})")
        else:
            print(
                f"    - {d['act_key']} → {d['service']}  "
                f"[do weryfikacji: {d['needs_review_count']}]  {d['html_file']}"
            )
    if not args.dry_run and report.drafts:
        print(f"\n  Lokalizacja: output/review_queue/<serwis>/  — wymagają akceptacji redakcji.")


def main() -> None:
    p = argparse.ArgumentParser(prog="lexine", description="Pipeline treści prawnych Lexine")
    sub = p.add_subparsers(dest="cmd", required=True)
    today_year = dt.date.today().year

    pi = sub.add_parser("ingest", help="Pobierz listę aktów z Dz.U.")
    pi.add_argument("--year", type=int, default=today_year)
    pi.add_argument("--since", help="tylko ogłoszone od daty YYYY-MM-DD")
    pi.add_argument("--limit", type=int, default=30)
    pi.set_defaults(func=_cmd_ingest)

    pt = sub.add_parser("triage", help="Oceń i zrutuj akty (bez generacji)")
    pt.add_argument("--year", type=int, default=today_year)
    pt.add_argument("--since")
    pt.add_argument("--limit", type=int, default=20)
    pt.add_argument("--threshold", type=float, default=6.0)
    pt.set_defaults(func=_cmd_triage)

    pr = sub.add_parser("run", help="Pełny przebieg: ingest → ... → kolejka redakcyjna")
    pr.add_argument("--year", type=int, default=today_year)
    pr.add_argument("--since")
    pr.add_argument("--scan-limit", type=int, default=60, dest="scan_limit")
    pr.add_argument("--max", type=int, default=5, help="maks. artykułów na przebieg")
    pr.add_argument("--threshold", type=float, default=6.0)
    pr.add_argument("--dry-run", action="store_true", help="sama selekcja, bez wywołań generacji")
    pr.set_defaults(func=_cmd_run)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
