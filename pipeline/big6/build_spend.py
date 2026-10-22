"""Step 2 - spend: one row per incoming player, and spend per club per season.

Transfermarkt fees (euros) cover 2009/10 to 2022/23. Later windows come from press
round-ups in data/big6/curated/recent_signings.csv; fees reported in pounds are converted
at the yearly average rate for the window's calendar year.

Writes processed/signings.json, totals.json and fx.json.
"""
import collections

from common import (CLUBS, CURATED, FIRST_YEAR, PROCESSED, STAGING, YOUTH_TEAM, gbp_to_eur, opt_float,
                    read_csv, read_json, short_season, window_year, write_json)

TYPE_LABEL = {"transfer": "Transfer", "free": "Free", "loan": "Loan", "undisclosed": "Undisclosed"}


def classify_tm(fee_raw, from_club):
    """Map Transfermarkt's fee text to a deal type. Returns None for moves that aren't signings."""
    if fee_raw.startswith("End of loan"):
        return None                                    # player coming back from a loan
    if fee_raw == "-" and YOUTH_TEAM.search(from_club or ""):
        return None                                    # academy promotion
    if fee_raw.startswith("Loan fee") or fee_raw == "loan transfer":
        return "loan"
    if fee_raw == "free transfer" or (fee_raw == "-" and from_club in ("Without Club", "Career break")):
        return "free"
    if fee_raw in ("?", "-"):
        return "undisclosed"
    return "transfer"


def main():
    rate = gbp_to_eur()
    rows = []
    for r in read_json(STAGING / "ins.json"):
        if r["year"] < FIRST_YEAR:
            continue
        kind = classify_tm(r["fee_raw"], r["other_club"])
        if kind is None:
            continue
        fee = r["fee_m_eur"] or None
        rows.append({"club": r["club"], "season": short_season(r["season"]), "window": r["window"],
                     "player": r["player"], "from": r["other_club"],
                     "fee_eur": round(fee, 2) if fee else None, "fee_gbp_reported": None,
                     "type": kind, "src": "tm"})

    for r in read_csv(CURATED / "recent_signings.csv"):
        fee = opt_float(r["fee"])
        eur = None if fee is None else fee if r["currency"] == "EUR" else fee * rate[window_year(r["season"], r["window"])]
        rows.append({"club": r["club"], "season": r["season"], "window": r["window"],
                     "player": r["player"], "from": r["from_club"],
                     "fee_eur": round(eur, 2) if eur else None,
                     "fee_gbp_reported": fee if r["currency"] == "GBP" else None,
                     "type": r["deal_type"], "src": r["source"]})

    # spend per club-season (gross: fees paid, nothing taken off for sales)
    tot = collections.defaultdict(lambda: {"spend": 0.0, "paid": 0, "signings": 0})
    for r in rows:
        t = tot[(r["season"], r["club"])]
        t["signings"] += 1
        if r["fee_eur"]:
            t["spend"] += r["fee_eur"]
            t["paid"] += 1
    seasons = sorted({r["season"] for r in rows})
    totals = [{"season": s, "club": c, "spend_eur_m": round(tot[(s, c)]["spend"], 1),
               "paid_signings": tot[(s, c)]["paid"], "signings": tot[(s, c)]["signings"]}
              for s in seasons for c in CLUBS]

    rows.sort(key=lambda r: (r["club"], r["season"], r["window"] != "Summer", -(r["fee_eur"] or 0), r["player"]))
    for i, r in enumerate(rows, 1):
        r["id"] = f"s{i:04d}"
        r["window"] = "Summer" if r["window"] == "Summer" else "January"
        r["type"] = TYPE_LABEL[r["type"]]

    write_json(PROCESSED / "signings.json", rows)
    write_json(PROCESSED / "totals.json", totals)
    write_json(PROCESSED / "fx.json", [{"year": y, "gbp_to_eur": v, "applies_to": f"Deals in {y} windows reported in pounds"}
                                       for y, v in sorted(rate.items())])
    spend = collections.Counter()
    for t in totals:
        spend[t["club"]] += t["spend_eur_m"]
    print(f"  spend: {len(rows):,} incoming players over {len(seasons)} seasons; "
          + ", ".join(f"{c} €{spend[c]:,.0f}m" for c in CLUBS))


if __name__ == "__main__":
    main()
