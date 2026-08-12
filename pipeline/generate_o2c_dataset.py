"""
==============================================================================
 O2C (Order-to-Cash) Synthetic Dataset Generator
==============================================================================
 Purpose : Generate a realistic Order-to-Cash dataset for a Power BI portfolio
           project, simulating a multinational energy company's operations.

 Output  : 7 CSV files in ./output/
              - dim_date.csv
              - dim_customers.csv
              - dim_products.csv
              - fact_orders.csv
              - fact_deliveries.csv
              - fact_invoices.csv
              - fact_payments.csv

 Embedded business patterns (so your dashboard has real stories to tell):
   1. APAC region has higher % of stuck orders (credit holds)
   2. Q4 has an order volume spike (+30%) — fiscal year end
   3. Aviation segment pays slower than Industrial — higher DSO
   4. Lubricants have higher margin than Fuel
   5. ~8% of orders get stuck; ~5% of invoices get disputed
   6. On-time delivery hovers around 92% (below the 95% target)
   7. Some customers consistently pay late (concentration risk)

 How to run:
   pip install pandas numpy faker
   python generate_o2c_dataset.py

 Author : [Your Name] — Portfolio project
==============================================================================
"""

import os
import random
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from faker import Faker

# ------------------------------------------------------------------ #
# Configuration                                                       #
# ------------------------------------------------------------------ #
RANDOM_SEED = 42
random.seed(RANDOM_SEED)
np.random.seed(RANDOM_SEED)
fake = Faker()
Faker.seed(RANDOM_SEED)

# Date range
START_DATE = datetime(2023, 1, 1)
END_DATE = datetime(2025, 12, 31)

# Row counts
N_CUSTOMERS = 500
N_PRODUCTS = 50
N_ORDERS = 50000

# Output folder — resolves to the repo's data/ directory regardless of where
# the script is run from, so `python pipeline/generate_o2c_dataset.py` from the
# repo root refreshes the same tables the build script reads.
OUTPUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"
)
os.makedirs(OUTPUT_DIR, exist_ok=True)


# ------------------------------------------------------------------ #
# 1. DIM_DATE                                                         #
# ------------------------------------------------------------------ #
def build_dim_date() -> pd.DataFrame:
    """Date dimension covering the full range with fiscal & calendar attrs."""
    dates = pd.date_range(START_DATE, END_DATE, freq="D")
    df = pd.DataFrame({"date": dates})
    df["date_id"] = df["date"].dt.strftime("%Y%m%d").astype(int)
    df["year"] = df["date"].dt.year
    df["quarter"] = df["date"].dt.quarter
    df["month"] = df["date"].dt.month
    df["month_name"] = df["date"].dt.strftime("%b")
    df["week"] = df["date"].dt.isocalendar().week
    df["weekday"] = df["date"].dt.day_name()
    df["is_weekend"] = df["date"].dt.weekday >= 5
    df["fiscal_period"] = df["year"].astype(str) + "-P" + df["month"].astype(str).str.zfill(2)
    return df[["date_id", "date", "year", "quarter", "month", "month_name",
               "week", "weekday", "is_weekend", "fiscal_period"]]


# ------------------------------------------------------------------ #
# 2. DIM_CUSTOMERS                                                    #
# ------------------------------------------------------------------ #
REGIONS = {
    "APAC":     ["Malaysia", "Singapore", "Indonesia", "Thailand", "Vietnam",
                 "Australia", "Japan", "South Korea", "India", "Philippines"],
    "EMEA":     ["United Kingdom", "Germany", "France", "Netherlands",
                 "UAE", "Saudi Arabia", "South Africa", "Italy", "Spain", "Norway"],
    "Americas": ["United States", "Canada", "Brazil", "Mexico", "Argentina",
                 "Colombia", "Chile"],
}

SEGMENTS = ["B2B Fleet", "Aviation", "Marine", "Industrial"]
CREDIT_TERMS = [30, 45, 60, 90]

# Bias: APAC tends to skew toward shorter credit; EMEA toward longer (realistic)
REGION_CREDIT_WEIGHTS = {
    "APAC":     [0.50, 0.30, 0.15, 0.05],
    "EMEA":     [0.20, 0.30, 0.30, 0.20],
    "Americas": [0.30, 0.35, 0.25, 0.10],
}

# Segment-level payment behaviour (avg days beyond due date; std dev)
# Aviation is the worst payer — keep this consistent across the data
SEGMENT_PAYMENT_BEHAVIOUR = {
    "B2B Fleet":  (3,  8),
    "Aviation":   (12, 15),
    "Marine":     (6,  10),
    "Industrial": (1,  5),
}


def build_dim_customers() -> pd.DataFrame:
    rows = []
    for i in range(1, N_CUSTOMERS + 1):
        region = random.choices(list(REGIONS.keys()), weights=[0.40, 0.35, 0.25])[0]
        country = random.choice(REGIONS[region])
        segment = random.choice(SEGMENTS)
        credit_terms = random.choices(CREDIT_TERMS, weights=REGION_CREDIT_WEIGHTS[region])[0]
        credit_limit = random.choice([50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000])
        onboarding_date = fake.date_between(start_date="-5y", end_date="-1y")

        rows.append({
            "customer_id":      f"CUST{i:05d}",
            "customer_name":    fake.company(),
            "region":           region,
            "country":          country,
            "segment":          segment,
            "credit_terms_days": credit_terms,
            "credit_limit_usd":  credit_limit,
            "account_manager":   fake.name(),
            "onboarding_date":   onboarding_date,
        })
    return pd.DataFrame(rows)


# ------------------------------------------------------------------ #
# 3. DIM_PRODUCTS                                                     #
# ------------------------------------------------------------------ #
PRODUCT_CATEGORIES = {
    # category : (unit_of_measure, price_range, margin_range)
    "Fuel":       ("Litres",  (0.80, 1.50),  (0.05, 0.12)),
    "Lubricants": ("Litres",  (3.00, 12.00), (0.25, 0.45)),
    "Bitumen":    ("MT",      (450, 700),    (0.10, 0.18)),
    "LPG":        ("MT",      (550, 850),    (0.12, 0.22)),
}

FUEL_NAMES = ["Diesel Premium", "Diesel Regular", "Gasoline 95", "Gasoline 97",
              "Jet A-1", "Marine Gas Oil", "Heavy Fuel Oil"]
LUBE_NAMES = ["Engine Oil 5W-30", "Hydraulic Fluid HF-46", "Turbine Oil T-32",
              "Gear Oil 80W-90", "Greaseline EP2", "Compressor Oil CO-100",
              "Transmission Fluid ATF"]
BITUMEN_NAMES = ["Bitumen 60/70", "Bitumen 80/100", "Polymer Modified Bitumen",
                 "Emulsion Bitumen"]
LPG_NAMES = ["Propane Industrial", "Butane Commercial", "LPG Auto-Gas",
             "LPG Mixed C3/C4"]


def build_dim_products() -> pd.DataFrame:
    rows, pid = [], 1
    name_pool = {
        "Fuel":       FUEL_NAMES,
        "Lubricants": LUBE_NAMES,
        "Bitumen":    BITUMEN_NAMES,
        "LPG":        LPG_NAMES,
    }
    while pid <= N_PRODUCTS:
        category = random.choices(
            list(PRODUCT_CATEGORIES.keys()), weights=[0.40, 0.30, 0.15, 0.15]
        )[0]
        uom, price_range, margin_range = PRODUCT_CATEGORIES[category]
        base_name = random.choice(name_pool[category])
        grade = random.choice(["Std", "Pro", "Elite", "ECO", "X1", "MAX"])
        product_name = f"{base_name} - {grade}"

        rows.append({
            "product_id":      f"PROD{pid:04d}",
            "product_name":    product_name,
            "category":        category,
            "unit_of_measure": uom,
            "unit_price_usd":  round(np.random.uniform(*price_range), 2),
            "gross_margin_pct": round(np.random.uniform(*margin_range), 4),
        })
        pid += 1
    return pd.DataFrame(rows)


# ------------------------------------------------------------------ #
# 4. FACT_ORDERS                                                      #
# ------------------------------------------------------------------ #
# Order status mix — overall targets:
#   Delivered ~85%, Stuck ~8%, Cancelled ~4%, Open ~3%
ORDER_STATUS_WEIGHTS = [0.85, 0.08, 0.04, 0.03]
ORDER_STATUS_VALUES = ["Delivered", "Stuck", "Cancelled", "Open"]

STUCK_REASONS = ["Credit Hold", "Stock Out", "Pricing Issue",
                 "Customer Hold", "Documentation Missing"]
# APAC skews to Credit Hold reasons — embed regional pattern
STUCK_REASON_WEIGHTS_BY_REGION = {
    "APAC":     [0.55, 0.15, 0.10, 0.15, 0.05],
    "EMEA":     [0.20, 0.25, 0.20, 0.25, 0.10],
    "Americas": [0.25, 0.30, 0.20, 0.15, 0.10],
}

SALES_CHANNELS = ["Direct", "Online Portal", "Distributor"]
CHANNEL_WEIGHTS = [0.50, 0.20, 0.30]


def _q4_weighted_dates(n: int) -> np.ndarray:
    """Generate order dates skewed toward Q4 (fiscal-year-end spike)."""
    days_range = (END_DATE - START_DATE).days
    raw = np.random.randint(0, days_range, size=n * 2)  # over-sample
    candidate_dates = np.array([START_DATE + timedelta(days=int(d)) for d in raw])
    # Boost Q4 selection probability
    weights = np.array([1.3 if d.month in (10, 11, 12) else 1.0
                        for d in candidate_dates])
    probs = weights / weights.sum()
    chosen_idx = np.random.choice(len(candidate_dates), size=n, replace=False, p=probs)
    return candidate_dates[chosen_idx]


def build_fact_orders(customers: pd.DataFrame, products: pd.DataFrame) -> pd.DataFrame:
    customer_lookup = customers.set_index("customer_id")[["region", "segment"]].to_dict("index")

    order_dates = _q4_weighted_dates(N_ORDERS)
    rows = []
    for i in range(N_ORDERS):
        cust_id = random.choice(customers["customer_id"].tolist())
        prod_row = products.sample(1).iloc[0]
        region = customer_lookup[cust_id]["region"]

        order_date = order_dates[i]
        lead_time_days = random.randint(3, 21)
        requested_delivery_date = order_date + timedelta(days=lead_time_days)

        quantity = random.choice([100, 250, 500, 1000, 2500, 5000, 10000])
        order_value = round(quantity * prod_row["unit_price_usd"], 2)

        status = random.choices(ORDER_STATUS_VALUES, weights=ORDER_STATUS_WEIGHTS)[0]

        # Slightly boost stuck rate for APAC (realistic — supports our narrative)
        if region == "APAC" and status == "Delivered" and random.random() < 0.04:
            status = "Stuck"

        stuck_reason = None
        if status == "Stuck":
            stuck_reason = random.choices(
                STUCK_REASONS, weights=STUCK_REASON_WEIGHTS_BY_REGION[region]
            )[0]

        rows.append({
            "order_id":                f"ORD{i+1:07d}",
            "customer_id":             cust_id,
            "product_id":              prod_row["product_id"],
            "order_date":              order_date.date(),
            "requested_delivery_date": requested_delivery_date.date(),
            "quantity":                quantity,
            "order_value_usd":         order_value,
            "order_status":            status,
            "sales_channel":           random.choices(SALES_CHANNELS, weights=CHANNEL_WEIGHTS)[0],
            "stuck_reason":            stuck_reason,
        })
    return pd.DataFrame(rows)


# ------------------------------------------------------------------ #
# 5. FACT_DELIVERIES                                                  #
# ------------------------------------------------------------------ #
def build_fact_deliveries(orders: pd.DataFrame) -> pd.DataFrame:
    """Only Delivered orders produce a delivery record."""
    delivered = orders[orders["order_status"] == "Delivered"].copy()
    rows = []
    for i, o in enumerate(delivered.itertuples(index=False), start=1):
        requested = pd.to_datetime(o.requested_delivery_date)

        # 92% on-time, 7% late, 1% failed (below the 95% SLA on purpose)
        roll = random.random()
        if roll < 0.92:
            status = "On-Time"
            variance = random.randint(-2, 0)
        elif roll < 0.99:
            status = "Late"
            variance = random.randint(1, 14)
        else:
            status = "Failed"
            variance = random.randint(15, 45)

        actual = requested + timedelta(days=variance)
        rows.append({
            "delivery_id":         f"DEL{i:07d}",
            "order_id":            o.order_id,
            "actual_delivery_date": actual.date(),
            "delivery_status":     status,
            "variance_days":       variance,
        })
    return pd.DataFrame(rows)


# ------------------------------------------------------------------ #
# 6. FACT_INVOICES                                                    #
# ------------------------------------------------------------------ #
DISPUTE_REASONS = ["Pricing Discrepancy", "Quantity Mismatch", "Tax Error",
                   "Wrong Customer Code", "Duplicate Invoice"]


def build_fact_invoices(orders: pd.DataFrame, deliveries: pd.DataFrame) -> pd.DataFrame:
    """One invoice per delivered order, issued 1-7 days after delivery."""
    merged = deliveries.merge(
        orders[["order_id", "order_value_usd"]], on="order_id", how="left"
    )
    rows = []
    for i, r in enumerate(merged.itertuples(index=False), start=1):
        invoice_lag = random.randint(1, 7)
        invoice_date = pd.to_datetime(r.actual_delivery_date) + timedelta(days=invoice_lag)

        # ~5% disputed, ~93% paid/issued (the rest categorised below)
        roll = random.random()
        if roll < 0.05:
            status = "Disputed"
            dispute_reason = random.choice(DISPUTE_REASONS)
        else:
            status = "Issued"  # default; will be flipped to Paid/Overdue at payment step
            dispute_reason = None

        rows.append({
            "invoice_id":         f"INV{i:07d}",
            "order_id":           r.order_id,
            "invoice_date":       invoice_date.date(),
            "invoice_amount_usd": r.order_value_usd,
            "invoice_status":     status,
            "dispute_reason":     dispute_reason,
        })
    return pd.DataFrame(rows)


# ------------------------------------------------------------------ #
# 7. FACT_PAYMENTS                                                    #
# ------------------------------------------------------------------ #
def build_fact_payments(
    invoices: pd.DataFrame,
    orders: pd.DataFrame,
    customers: pd.DataFrame,
) -> pd.DataFrame:
    """Payments for invoices. Aviation pays slowest; some customers always late."""
    # Pick 5% of customers to be 'chronic late payers' — adds a concentration story
    chronic_late_payers = set(
        customers["customer_id"].sample(frac=0.05, random_state=RANDOM_SEED).tolist()
    )

    cust_segment = customers.set_index("customer_id")["segment"].to_dict()
    cust_terms   = customers.set_index("customer_id")["credit_terms_days"].to_dict()
    order_cust   = orders.set_index("order_id")["customer_id"].to_dict()

    # Disputed invoices don't pay (or pay much later) → drop them from payments
    payable = invoices[invoices["invoice_status"] != "Disputed"].copy()

    rows = []
    today = END_DATE.date()  # reference point for overdue calculation

    for i, inv in enumerate(payable.itertuples(index=False), start=1):
        cust_id = order_cust[inv.order_id]
        segment = cust_segment[cust_id]
        terms = cust_terms[cust_id]
        mean_offset, std_offset = SEGMENT_PAYMENT_BEHAVIOUR[segment]

        # Days to pay = credit_terms + segment-driven offset
        offset = int(np.random.normal(mean_offset, std_offset))
        if cust_id in chronic_late_payers:
            offset += random.randint(15, 40)

        days_to_pay = max(1, terms + offset)
        payment_date = pd.to_datetime(inv.invoice_date) + timedelta(days=days_to_pay)

        # If payment_date is in the future relative to END_DATE → mark as unpaid (skip)
        if payment_date.date() > today:
            continue

        rows.append({
            "payment_id":      f"PAY{i:07d}",
            "invoice_id":      inv.invoice_id,
            "payment_date":    payment_date.date(),
            "amount_paid_usd": inv.invoice_amount_usd,
            "payment_method":  random.choice(["Bank Transfer", "Letter of Credit", "Cheque"]),
            "days_to_pay":     days_to_pay,
        })
    return pd.DataFrame(rows)


# ------------------------------------------------------------------ #
# Post-processing: flip invoice statuses based on payment outcome     #
# ------------------------------------------------------------------ #
def reconcile_invoice_statuses(
    invoices: pd.DataFrame, payments: pd.DataFrame, customers: pd.DataFrame, orders: pd.DataFrame
) -> pd.DataFrame:
    """Flip Issued -> Paid where payment exists; otherwise Overdue if past due."""
    today = END_DATE.date()
    paid_ids = set(payments["invoice_id"].tolist())

    order_to_cust = orders.set_index("order_id")["customer_id"].to_dict()
    cust_terms = customers.set_index("customer_id")["credit_terms_days"].to_dict()

    def _resolve(row):
        if row["invoice_status"] == "Disputed":
            return "Disputed"
        if row["invoice_id"] in paid_ids:
            return "Paid"
        # Not paid — check whether it's overdue based on credit terms
        cust = order_to_cust.get(row["order_id"])
        terms = cust_terms.get(cust, 30)
        due_date = pd.to_datetime(row["invoice_date"]) + timedelta(days=terms)
        return "Overdue" if due_date.date() < today else "Issued"

    invoices["invoice_status"] = invoices.apply(_resolve, axis=1)
    return invoices


# ------------------------------------------------------------------ #
# MAIN                                                                #
# ------------------------------------------------------------------ #
def main() -> None:
    print("Generating O2C synthetic dataset...\n")

    print("[1/7] dim_date ...")
    dim_date = build_dim_date()
    dim_date.to_csv(f"{OUTPUT_DIR}/dim_date.csv", index=False)

    print("[2/7] dim_customers ...")
    dim_customers = build_dim_customers()
    dim_customers.to_csv(f"{OUTPUT_DIR}/dim_customers.csv", index=False)

    print("[3/7] dim_products ...")
    dim_products = build_dim_products()
    dim_products.to_csv(f"{OUTPUT_DIR}/dim_products.csv", index=False)

    print("[4/7] fact_orders ...")
    fact_orders = build_fact_orders(dim_customers, dim_products)
    fact_orders.to_csv(f"{OUTPUT_DIR}/fact_orders.csv", index=False)

    print("[5/7] fact_deliveries ...")
    fact_deliveries = build_fact_deliveries(fact_orders)
    fact_deliveries.to_csv(f"{OUTPUT_DIR}/fact_deliveries.csv", index=False)

    print("[6/7] fact_invoices ...")
    fact_invoices = build_fact_invoices(fact_orders, fact_deliveries)

    print("[7/7] fact_payments ...")
    fact_payments = build_fact_payments(fact_invoices, fact_orders, dim_customers)

    # Reconcile invoice status after payments are built
    fact_invoices = reconcile_invoice_statuses(
        fact_invoices, fact_payments, dim_customers, fact_orders
    )
    fact_invoices.to_csv(f"{OUTPUT_DIR}/fact_invoices.csv", index=False)
    fact_payments.to_csv(f"{OUTPUT_DIR}/fact_payments.csv", index=False)

    # ------------------------------------------------------------------ #
    # Summary printout (sanity check)                                     #
    # ------------------------------------------------------------------ #
    print("\n" + "=" * 60)
    print("DATASET SUMMARY")
    print("=" * 60)
    print(f"dim_date         : {len(dim_date):>8,} rows")
    print(f"dim_customers    : {len(dim_customers):>8,} rows")
    print(f"dim_products     : {len(dim_products):>8,} rows")
    print(f"fact_orders      : {len(fact_orders):>8,} rows")
    print(f"fact_deliveries  : {len(fact_deliveries):>8,} rows")
    print(f"fact_invoices    : {len(fact_invoices):>8,} rows")
    print(f"fact_payments    : {len(fact_payments):>8,} rows")
    print("=" * 60)

    print("\nOrder status mix:")
    print(fact_orders["order_status"].value_counts(normalize=True).round(3))

    print("\nStuck orders by region (concentration story):")
    stuck = fact_orders[fact_orders["order_status"] == "Stuck"].merge(
        dim_customers[["customer_id", "region"]], on="customer_id"
    )
    print(stuck["region"].value_counts(normalize=True).round(3))

    print("\nInvoice status mix:")
    print(fact_invoices["invoice_status"].value_counts(normalize=True).round(3))

    print("\nAvg days_to_pay by segment (Aviation should be highest):")
    pay_seg = fact_payments.merge(
        fact_invoices[["invoice_id", "order_id"]], on="invoice_id"
    ).merge(
        fact_orders[["order_id", "customer_id"]], on="order_id"
    ).merge(
        dim_customers[["customer_id", "segment"]], on="customer_id"
    )
    print(pay_seg.groupby("segment")["days_to_pay"].mean().round(1))

    print(f"\nAll files written to: {os.path.abspath(OUTPUT_DIR)}")
    print("Ready to load into Power BI.\n")


if __name__ == "__main__":
    main()
