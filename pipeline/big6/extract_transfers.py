"""Step 1 - extract: download the pinned Transfermarkt file and keep the Big Six's moves.

Writes data/big6/staging/ins.json (every incoming move since 1992, needed to find what a
player sold later had cost) and staging/outs.json (outgoing moves from 2009/10).
"""
import argparse
import csv
import hashlib
import shutil
import urllib.request

from common import FIRST_YEAR, RAW, SOURCE_SHA256, SOURCE_URL, STAGING, TM_CLUB_NAMES, write_json

RAW_FILE = RAW / "premier-league.csv"


def fetch(source=None):
    """Use a local copy if given, else download once and cache. Either way, check the hash."""
    RAW.mkdir(parents=True, exist_ok=True)
    if source:
        shutil.copyfile(source, RAW_FILE)
    elif not RAW_FILE.exists():
        print(f"  downloading {SOURCE_URL}")
        with urllib.request.urlopen(SOURCE_URL, timeout=60) as resp, open(RAW_FILE, "wb") as fh:
            shutil.copyfileobj(resp, fh)
    digest = hashlib.sha256(RAW_FILE.read_bytes()).hexdigest()
    if digest != SOURCE_SHA256:
        raise SystemExit(f"premier-league.csv hash {digest[:12]}... does not match the pinned file")
    return RAW_FILE


def fee_m_eur(value):
    try:
        return float(value) if value not in ("", "NA") else None
    except ValueError:
        return None


def main(source=None):
    path = fetch(source)
    ins, outs = [], []
    with open(path, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            club = TM_CLUB_NAMES.get(r["club_name"])
            if not club:
                continue
            row = {
                "club": club, "player": r["player_name"], "other_club": r["club_involved_name"],
                "fee_raw": r["fee"], "fee_m_eur": fee_m_eur(r["fee_cleaned"]),
                "window": r["transfer_period"], "season": r["season"], "year": int(r["year"]),
            }
            if r["transfer_movement"] == "in":
                ins.append(row)
            elif r["transfer_movement"] == "out" and row["year"] >= FIRST_YEAR:
                outs.append(row)
    write_json(STAGING / "ins.json", ins)
    write_json(STAGING / "outs.json", outs)
    print(f"  extract: {len(ins):,} incoming moves since 1992, {len(outs):,} outgoing since {FIRST_YEAR}/{str(FIRST_YEAR + 1)[-2:]}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", help="path to a local copy of premier-league.csv")
    main(ap.parse_args().source)
