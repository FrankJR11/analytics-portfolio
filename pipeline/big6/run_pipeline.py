"""Rebuild the Big Six transfer dashboard's data from source, end to end.

    python pipeline/big6/run_pipeline.py                 # downloads the pinned source once
    python pipeline/big6/run_pipeline.py --source FILE   # or use a local premier-league.csv

extract -> spend -> sales -> reference -> validate -> serve
"""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_dashboard_data  # noqa: E402
import build_reference  # noqa: E402
import build_sales  # noqa: E402
import build_spend  # noqa: E402
import extract_transfers  # noqa: E402
import validate  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", help="path to a local copy of premier-league.csv")
    args = ap.parse_args()
    t0 = time.time()
    extract_transfers.main(args.source)
    build_spend.main()
    build_sales.main()      # needs spend's signings and totals
    build_reference.main()
    validate.main()         # stops here if any check fails
    build_dashboard_data.main()
    print(f"done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
