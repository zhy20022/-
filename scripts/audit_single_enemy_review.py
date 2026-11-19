"""Compare production rotations and pressure cases with and without exclusive gear."""
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from fractions import Fraction
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts import audit_exclusive_review as audit
from scripts.audit_exclusive_pressure import run as pressure_run

COUNTS = (1, 2, 3, 5, 10)
DPS = {n for n, row in audit.BY_NUMBER.items() if row["professionType"].endswith("_DPS")}


def run(case):
    equipped, kind, args = case
    if kind == "rotation":
        row = audit.rotation_run(args, equipped=equipped)
    else:
        row = pressure_run(*args, equipped=equipped)
    return dict(equipped=equipped, kind=kind, **row)


def report(rows):
    grouped = defaultdict(list)
    for r in rows:
        if r["kind"] == "rotation":
            grouped[r["targets"], r["equipped"], r["number"]].append(r["totalDamage"])
    cards = {n: dict(number=n, name=r["name"], role=r["professionName"], dps=n in DPS, scenes={})
             for n, r in audit.BY_NUMBER.items()}
    limits = {}
    for count in COUNTS:
        for equipped in (False, True):
            scores = {n: Fraction(sum(grouped[count, equipped, n]), 3) for n in cards}
            assert all(len(grouped[count, equipped, n]) == 3 for n in cards)
            key = "equipped" if equipped else "base"
            top = max(sorted(DPS), key=scores.get)
            low = min(sorted(DPS), key=scores.get)
            limits.setdefault(count, {})[key] = dict(
                top=top, low=low, highDamage=float(scores[top]), lowDamage=float(scores[low]),
                ratio=float(scores[top] / scores[low]))
            for n, score in scores.items():
                cards[n]["scenes"].setdefault(count, {})[key] = dict(
                    damage=float(score), allRank=1 + sum(v > score for v in scores.values()),
                    roleRank=1 + sum(scores[m] > score for m in DPS) if n in DPS else None)
    assert limits[1]["base"]["ratio"] <= 2
    return dict(characters=list(cards.values()), limits=limits)


def main():
    out = Path(sys.argv[1])
    cases = [(eq, "rotation", (n, count, True, seed)) for eq in (False, True)
             for n in audit.BY_NUMBER for count in COUNTS for seed in range(3)]
    cases += [(eq, "pressure", (n, size, school, 3000, seed, False))
              for eq in (False, True) for n, r in audit.BY_NUMBER.items() if n not in DPS
              for size in [(1 if r["professionType"].endswith("TANK") else 5)]
              for school in ("physical", "magical") for seed in range(3)]
    with ProcessPoolExecutor(max_workers=6) as pool:
        rows = list(pool.map(run, cases, chunksize=8))
    data = report(rows)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("x", encoding="utf-8") as f:
        json.dump(dict(**data, runs=rows), f, ensure_ascii=False, indent=2)
    print(f"{len(rows)} cases; limits = {data['limits']}")


if __name__ == "__main__":
    main()
