"""Step 5 - data quality: checks that hold across the processed tables before anything ships.

Each check is a plain function that returns a list of problems. Any problem stops the
pipeline before the dashboard payload is rewritten.
"""
import collections

from common import CLUBS, PROCESSED, read_json

DATASETS = ["signings", "totals", "fx", "sales", "sales_totals", "sales_profit", "competitions", "league_positions",
            "city_revenue", "wages", "top_earners", "managers", "manager_pay",
            "source_list", "season_sources", "wage_sources", "sales_sources"]
MAX_FEE_EUR_M = 250   # above any fee ever paid; catches unit slips such as £ entered as €k


def unique(d, name, key):
    seen = collections.Counter(tuple(r[k] for k in key) for r in d[name])
    return [f"{name}: duplicate {key} {k}" for k, n in seen.items() if n > 1]


def sources_resolve(d, name, sources, field="src", allow_blank=False):
    keys = {s["key"] for s in d[sources]}
    return [f"{name} {r.get('id', r.get('season'))}: source {r[field]!r} not in {sources}"
            for r in d[name] if r[field] not in keys and not (allow_blank and r[field] == "")]


def fees_in_range(d, name, fields):
    out = []
    for r in d[name]:
        for f in fields:
            v = r[f]
            if v is not None and not (0 <= v <= MAX_FEE_EUR_M):
                out.append(f"{name} {r['id']}: {f}={v} outside 0-{MAX_FEE_EUR_M}")
    return out


def totals_match_rows(d):
    """Spend per club-season must equal the sum of the signing fees it came from."""
    rows = collections.defaultdict(float)
    for r in d["signings"]:
        rows[(r["season"], r["club"])] += r["fee_eur"] or 0
    return [f"totals {t['club']} {t['season']}: {t['spend_eur_m']} != rows {rows[(t['season'], t['club'])]:.2f}"
            for t in d["totals"] if abs(t["spend_eur_m"] - rows[(t["season"], t["club"])]) > 0.051]


def sales_reconcile(d):
    spend = {(t["season"], t["club"]): t["spend_eur_m"] for t in d["totals"]}
    income = collections.defaultdict(float)
    for r in d["sales"]:
        income[(r["season"], r["club"])] += r["fee_eur"] or 0
    out = []
    for t in d["sales_totals"]:
        k = (t["season"], t["club"])
        if t["spend_eur_m"] != spend[k]:
            out.append(f"sales_totals {k}: spend differs from totals")
        if abs(t["sales_eur_m"] - income[k]) > 0.051:
            out.append(f"sales_totals {k}: sales {t['sales_eur_m']} != rows {income[k]:.2f}")
        if abs(t["net_spend_eur_m"] - (t["spend_eur_m"] - t["sales_eur_m"])) > 0.11:
            out.append(f"sales_totals {k}: net spend does not equal spend minus sales")
    return out


def gains_add_up(d):
    return [f"sales {r['id']}: gain {r['gain_eur']} != fee - cost"
            for r in d["sales"] if r["gain_eur"] is not None and abs(r["gain_eur"] - (r["fee_eur"] - r["cost_eur"])) > 0.011]


def full_grid(d, name):
    seasons = sorted({r["season"] for r in d[name]})
    have = {(r["season"], r["club"]) for r in d[name]}
    return [f"{name}: missing {c} {s}" for s in seasons for c in CLUBS if (s, c) not in have]


def sensible_values(d):
    out = [f"league_positions {r['club']} {r['season']}: position {r['position']}"
           for r in d["league_positions"] if not 1 <= r["position"] <= 20]
    out += [f"competitions {r['id']}: {r['games']} games" for r in d["competitions"] if not 0 <= r["games"] <= 60]
    out += [f"top_earners {r['id']}: weekly £{r['weekly_gbp']:,}" for r in d["top_earners"] if not 10_000 <= r["weekly_gbp"] <= 1_500_000]
    out += [f"city_revenue {r['season']}: parts do not add up to total" for r in d["city_revenue"]
            if abs(r["matchday"] + r["broadcasting"] + r["commercial"] - r["total"]) > 1.0]
    return out


def main():
    d = {name: read_json(PROCESSED / f"{name}.json") for name in DATASETS}
    problems = (
        unique(d, "signings", ["id"]) + unique(d, "sales", ["id"]) + unique(d, "competitions", ["id"])
        + unique(d, "totals", ["season", "club"]) + unique(d, "wages", ["id"]) + unique(d, "top_earners", ["id"])
        + sources_resolve(d, "signings", "source_list") + sources_resolve(d, "sales", "sales_sources")
        + sources_resolve(d, "competitions", "season_sources") + sources_resolve(d, "city_revenue", "season_sources")
        + sources_resolve(d, "wages", "wage_sources", allow_blank=True) + sources_resolve(d, "top_earners", "wage_sources")
        + sources_resolve(d, "manager_pay", "wage_sources")
        + fees_in_range(d, "signings", ["fee_eur"]) + fees_in_range(d, "sales", ["fee_eur", "cost_eur"])
        + totals_match_rows(d) + sales_reconcile(d) + gains_add_up(d)
        + full_grid(d, "totals") + full_grid(d, "sales_totals") + sensible_values(d)
    )
    if problems:
        print("\n".join(f"  FAIL {p}" for p in problems[:40]))
        raise SystemExit(f"validate: {len(problems)} problem(s)")
    print(f"  validate: {len(DATASETS)} tables, all checks passed")


if __name__ == "__main__":
    main()
