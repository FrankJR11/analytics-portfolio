"""Shared settings and helpers for the Big Six transfer pipeline.

Everything here is standard library: the pipeline runs on a plain Python 3.9+ install.
"""
import csv
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data" / "big6"
RAW = DATA / "raw"              # downloaded source file (not committed)
STAGING = DATA / "staging"      # intermediate extracts (not committed)
CURATED = DATA / "curated"      # hand-collected tables, one source per row (committed)
PROCESSED = DATA / "processed"  # model outputs the dashboard reads (committed)
SITE_PAYLOAD = ROOT / "docs" / "assets" / "big6-data.js"

# Transfermarkt history as collected by github.com/ewenme/transfers, pinned to one commit
# so a rebuild always starts from the same bytes.
SOURCE_COMMIT = "b531325a83bf3114f29546198ac4b73230402f52"
SOURCE_URL = f"https://raw.githubusercontent.com/ewenme/transfers/{SOURCE_COMMIT}/data/premier-league.csv"
SOURCE_SHA256 = "2631ad0b17b894e61f97a493b5bdc8cfb43660b0812dac8b8d6b15d06a8433b7"

DATA_AS_OF = "October 2026"     # last window covered: summer 2026

CLUBS = ["Man City", "Arsenal", "Chelsea", "Liverpool", "Man United", "Tottenham"]
TM_CLUB_NAMES = {
    "Manchester City": "Man City",
    "Arsenal FC": "Arsenal",
    "Chelsea FC": "Chelsea",
    "Liverpool FC": "Liverpool",
    "Manchester United": "Man United",
    "Tottenham Hotspur": "Tottenham",
}
FIRST_YEAR = 2009          # 2009/10, the first season the Premier League's charges against City cover
LAST_CHARGED = "2017/18"   # the last one
YOUTH_TEAM = re.compile(r"(U\d\d|Res\.|Youth|Academy)$")
SEASON = re.compile(r"^(\d{4})/(\d{2})$")


def short_season(s):
    """'2009/2010' -> '2009/10'; already-short seasons pass through."""
    return s[:5] + s[-2:] if len(s) == 9 else s


def window_year(season, window):
    """Calendar year a window falls in: summer = first year of the season, January = second."""
    start = int(season[:4])
    return start if window == "Summer" else start + 1


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def read_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path, rows):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False, separators=(",", ":"))


def opt_float(v):
    return float(v) if v not in ("", None) else None


def gbp_to_eur():
    """Yearly average £1 -> € rates used for fees reported in pounds."""
    return {int(r["year"]): float(r["gbp_to_eur"]) for r in read_csv(CURATED / "fx_rates.csv")}


def name_key(name):
    """Normalise a player name so 'Đorđe Petrović' and 'Djordje Petrovic' can be matched."""
    s = name.replace("ø", "o").replace("Ø", "O").replace("đ", "d").replace("Đ", "D").replace("ł", "l").replace("ß", "ss")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    s = re.sub(r"[^a-z]", "", s)
    return NAME_ALIASES.get(s, s)


# Spelling differences between Transfermarkt and the press round-ups
NAME_ALIASES = {
    "savio": "savinho", "angelo": "angelogabriel", "kepa": "keparrizabalaga",
    "djordjepetrovic": "dordepetrovic", "sonheungmin": "heungminson", "thiago": "thiagoalcantara",
    "bengannondoak": "bendoak", "natphillips": "nathanielphillips", "radamelfalcao": "falcao",
    "estevao": "estevaowillian",
}
