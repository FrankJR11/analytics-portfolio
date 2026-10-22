"""Step 4 - reference tables: load the hand-collected CSVs with a schema, and fail loudly.

These tables (competitions, league positions, wage bills, top earners, managers, revenue)
were researched by hand from the sources listed in the sources_*.csv files. This step
types every column, rejects anything that doesn't fit the schema, and writes JSON.
"""
from common import CLUBS, CURATED, PROCESSED, SEASON, read_csv, write_json


class SchemaError(ValueError):
    pass


def text(v):
    return v


def integer(v):
    return int(v)


def number(v):
    return float(v)


def opt_number(v):
    return float(v) if v != "" else None


def boolean(v):
    if v not in ("true", "false"):
        raise SchemaError(f"expected true/false, got {v!r}")
    return v == "true"


def club(v):
    if v not in CLUBS:
        raise SchemaError(f"unknown club {v!r}")
    return v


def season(v):
    m = SEASON.match(v)
    if not m or int(m.group(2)) != (int(m.group(1)) + 1) % 100:
        raise SchemaError(f"bad season {v!r}")
    return v


def yes_no(v):
    if v not in ("Yes", "No"):
        raise SchemaError(f"expected Yes/No, got {v!r}")
    return v


SOURCES = {"key": text, "name": text, "covers": text, "url": text}
TABLES = {
    # curated file: (dataset id the dashboard reads, column -> parser)
    "competitions.csv": ("competitions", {"id": text, "club": club, "season": season, "competition": text, "stage": text,
                                          "games": integer, "won": yes_no, "in_progress": boolean, "src": text}),
    "league_positions.csv": ("league_positions", {"season": season, "club": club, "position": integer, "final": boolean}),
    "city_revenue.csv": ("city_revenue", {"season": season, "matchday": number, "broadcasting": number,
                                          "commercial": number, "total": number, "src": text}),
    "wages.csv": ("wages", {"id": text, "season": season, "club": club, "wages_gbp_m": opt_number,
                            "revenue_gbp_m": opt_number, "src": text, "note": text}),
    "top_earners.csv": ("top_earners", {"id": text, "club": club, "season": season, "rank": integer, "player": text,
                                        "weekly_gbp": integer, "annual_gbp_m": number, "src": text, "note": text}),
    "managers.csv": ("managers", {"id": text, "club": club, "manager": text, "from": text, "to": text,
                                  "current": boolean, "role": text}),
    "manager_pay.csv": ("manager_pay", {"id": text, "manager_id": text, "club": club, "manager": text, "year": integer,
                                        "reported": text, "pay_gbp_m": number, "basis": text, "src": text}),
    "sources_spend.csv": ("source_list", SOURCES),
    "sources_seasons.csv": ("season_sources", SOURCES),
    "sources_wages.csv": ("wage_sources", SOURCES),
    "sources_sales.csv": ("sales_sources", SOURCES),
}


def load(fname, schema):
    raw = read_csv(CURATED / fname)
    if raw and set(raw[0]) != set(schema):
        raise SchemaError(f"{fname}: columns {sorted(raw[0])} != schema {sorted(schema)}")
    rows = []
    for line, r in enumerate(raw, start=2):
        try:
            rows.append({col: parse(r[col]) for col, parse in schema.items()})
        except (ValueError, SchemaError) as e:
            raise SchemaError(f"{fname} line {line}: {e}") from None
    return rows


def main():
    for fname, (dataset, schema) in TABLES.items():
        write_json(PROCESSED / f"{dataset}.json", load(fname, schema))
    print(f"  reference: {len(TABLES)} curated tables loaded and typed")


if __name__ == "__main__":
    main()
