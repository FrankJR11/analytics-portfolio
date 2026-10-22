"""Step 3 - sales: one row per outgoing player, what he cost, and the gain on the fee.

Each sale is matched to the same club's latest permanent signing of that player (by
normalised name), so gain = sale fee - purchase fee. Players who came through the youth
teams cost nothing. Also adds sale income and net spend per club-season, and the
"profit on disposal of players" figures from the clubs' accounts.

Writes processed/sales.json, sales_totals.json and sales_profit.json.
"""
import collections

from common import (CLUBS, CURATED, PROCESSED, STAGING, YOUTH_TEAM, gbp_to_eur, name_key, opt_float,
                    read_csv, read_json, short_season, window_year, write_json)

ORIGIN_LABEL = {"Bought": "Bought", "Free": "Free signing", "Academy": "Academy",
                "Undisclosed": "Bought, fee undisclosed", "Loan": "Loan, no permanent fee"}
RECENT_TYPE = {"transfer": "Transfer", "undisclosed": "Undisclosed", "free": "Free / released",
               "released": "Free / released", "loan": "Loan"}
# Senior signings the Transfermarkt extract is missing: (club, player, year, fee €m)
MISSING_PURCHASES = [("Chelsea", "Cesare Casadei", 2022, 15.0)]


def purchase_history():
    """(club, name key) -> [(year, kind, fee €m)] for every way the club acquired the player."""
    hist = collections.defaultdict(list)
    for r in read_json(STAGING / "ins.json"):
        f = r["fee_raw"]
        if f.startswith("End of loan"):
            continue
        if "loan" in f.lower():
            kind, fee = "Loan", None
        elif f == "free transfer":
            kind, fee = "Free", 0.0
        elif f in ("-", "?"):
            youth = bool(YOUTH_TEAM.search(r["other_club"] or ""))
            kind, fee = ("Academy", 0.0) if youth else ("Undisclosed", None)
        else:
            kind, fee = "Bought", r["fee_m_eur"] or 0.0
        hist[(r["club"], name_key(r["player"]))].append((int(r["season"][:4]), kind, fee))
    for r in read_json(PROCESSED / "signings.json"):          # windows after Transfermarkt's coverage
        if r["src"] == "tm":
            continue
        kind = {"Transfer": "Bought", "Free": "Free", "Loan": "Loan", "Undisclosed": "Undisclosed"}[r["type"]]
        fee = r["fee_eur"] if kind == "Bought" else (0.0 if kind == "Free" else None)
        hist[(r["club"], name_key(r["player"]))].append((int(r["season"][:4]), kind, fee))
    for club, player, year, fee in MISSING_PURCHASES:
        hist[(club, name_key(player))].append((year, "Bought", fee))
    return hist


def origin_of(hist, club, player, sale_year):
    """How the player arrived: his latest permanent move in (loans only if there was nothing else)."""
    moves = sorted((m for m in hist.get((club, name_key(player)), []) if m[0] <= sale_year), key=lambda m: m[0])
    if not moves:
        return "No purchase on record", None, None
    permanent = [m for m in moves if m[1] != "Loan"]
    year, kind, fee = (permanent or moves)[-1]
    return ORIGIN_LABEL[kind], fee, year


def classify_tm(fee_raw, to_club):
    if fee_raw.startswith("End of loan"):
        return None
    if "loan" in fee_raw.lower():
        return "Loan"
    if fee_raw == "free transfer" or (fee_raw == "-" and to_club in ("Without Club", "Career break", "Retired")):
        return "Free / released"
    if fee_raw in ("-", "?"):
        return "Undisclosed"
    return "Transfer"


def main():
    rate = gbp_to_eur()
    rows = []
    for r in read_json(STAGING / "outs.json"):
        kind = classify_tm(r["fee_raw"], r["other_club"] or "")
        if kind is None:
            continue
        fee = r["fee_m_eur"] or None
        rows.append({"club": r["club"], "season": short_season(r["season"]),
                     "window": "Summer" if r["window"] == "Summer" else "January",
                     "player": r["player"], "to": r["other_club"] or "", "fee_eur": round(fee, 2) if fee else None,
                     "fee_gbp_reported": None, "type": kind, "src": "tm"})
    for r in read_csv(CURATED / "recent_sales.csv"):
        fee = opt_float(r["fee"])
        eur = None if fee is None else fee if r["currency"] == "EUR" else fee * rate[window_year(r["season"], r["window"])]
        rows.append({"club": r["club"], "season": r["season"], "window": r["window"], "player": r["player"],
                     "to": r["to_club"], "fee_eur": round(eur, 2) if eur else None,
                     "fee_gbp_reported": fee if r["currency"] == "GBP" else None,
                     "type": RECENT_TYPE[r["deal_type"]], "src": r["source"]})

    hist = purchase_history()
    for r in rows:
        label, cost, joined = origin_of(hist, r["club"], r["player"], window_year(r["season"], r["window"]))
        if label == "No purchase on record" and r["src"] != "tm":
            # every senior signing since 2023 is in recent_signings.csv, so an unmatched
            # recent sale is a youth-team graduate whose promotion Transfermarkt didn't log
            label, cost = "Academy", 0.0
        r["origin"] = label
        r["cost_eur"] = round(cost, 2) if cost is not None else None
        r["joined"] = joined
        permanent = r["type"] == "Transfer"
        r["gain_eur"] = round(r["fee_eur"] - cost, 2) if (permanent and r["fee_eur"] and cost is not None) else None

    rows.sort(key=lambda r: (CLUBS.index(r["club"]), r["season"], r["window"] != "Summer", -(r["fee_eur"] or 0), r["player"]))
    for i, r in enumerate(rows, 1):
        r["id"] = f"x{i:04d}"
    write_json(PROCESSED / "sales.json", rows)

    # sale income and net spend per club-season
    spend = {(t["season"], t["club"]): t["spend_eur_m"] for t in read_json(PROCESSED / "totals.json")}
    income, count = collections.defaultdict(float), collections.Counter()
    for r in rows:
        if r["fee_eur"]:
            income[(r["season"], r["club"])] += r["fee_eur"]
            count[(r["season"], r["club"])] += 1
    totals = [{"season": s, "club": c, "sales_eur_m": round(income[(s, c)], 1), "sales_count": count[(s, c)],
               "spend_eur_m": spend[(s, c)], "net_spend_eur_m": round(spend[(s, c)] - income[(s, c)], 1)}
              for s in sorted({s for s, _ in spend}) for c in CLUBS]
    write_json(PROCESSED / "sales_totals.json", totals)

    # accounts: profit on disposal of players, £m, a full club x season grid with gaps left empty
    reported = {(r["club"], r["season"]): float(r["profit_gbp_m"]) for r in read_csv(CURATED / "accounts_profit_on_sales.csv")}
    grid = [{"id": f"a-{c.lower().replace(' ', '-')}-{y}", "club": c, "season": f"{y}/{str(y + 1)[-2:]}",
             "profit_gbp_m": reported.get((c, f"{y}/{str(y + 1)[-2:]}"))}
            for c in CLUBS for y in range(2012, 2025)]
    write_json(PROCESSED / "sales_profit.json", grid)

    paid = [r for r in rows if r["fee_eur"]]
    origins = collections.Counter(r["origin"] for r in paid)
    print(f"  sales: {len(rows):,} outgoing moves, {len(paid):,} with a fee; origins {dict(origins)}")


if __name__ == "__main__":
    main()
