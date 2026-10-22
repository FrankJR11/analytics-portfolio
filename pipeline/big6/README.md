# Big Six transfer spend & finances, 2009/10 to 2026

**[Open the dashboard →](https://frankjr11.github.io/analytics-portfolio/big6-dashboard.html)**

Real public data, not simulated. A Python pipeline turns Transfermarkt's transfer history,
press-reported fees and hand-collected figures from club accounts into one validated model.
A static d3 dashboard reads that model.

## The question

In February 2023 the Premier League charged Manchester City with 115 breaches of its
financial rules. Most of the charges cover 2009/10 to 2017/18. That raised two questions
the numbers can answer:

1. **Spending.** Did City spend more on players than the other five big clubs in those
   seasons, and since then?
2. **Selling.** How much of that spending did selling players pay back? Which clubs make a
   real profit from trading players, and where does that profit come from?

The dashboard has four tabs: transfer spend, seasons (trophies, games played, revenue,
league finishes), wages and managers' pay, and sales and profit.

## What the data says

| | Man City | Arsenal | Chelsea | Liverpool | Man United | Tottenham |
|---|---:|---:|---:|---:|---:|---:|
| Spend, 2009/10 to 2017/18 (charged seasons) | **€1.44bn** | €0.62bn | €1.12bn | €0.87bn | €1.01bn | €0.60bn |
| Spend, 2009/10 to summer 2026 | €3.48bn | €2.20bn | **€3.78bn** | €2.36bn | €2.71bn | €2.20bn |
| Income from player sales | €1.60bn | €0.88bn | **€2.45bn** | €1.31bn | €0.83bn | €1.22bn |
| Net spend (spend minus sales) | **€1.88bn** | €1.31bn | €1.33bn | €1.05bn | €1.88bn | €0.98bn |
| Gain on fees of players sold | +€140m | +€222m | +€435m | **+€479m** | −€114m | +€317m |

- **City outspent everyone in the charged seasons.** It spent €328m more than Chelsea, the
  next biggest spender. Across the whole period Chelsea spent more.
- **City became a seller late.** 76% of City's sale income came after 2017/18. Since 2022/23
  it has raised more from sales than any club except Chelsea.
- **City's trading gain comes almost entirely from its academy.** Graduates such as Palmer,
  McAtee and Bobb brought in €358m, all of it gain. Players City bought were sold for €217m
  less than they cost in total (Mahrez, Sterling and Laporte, for example).
- **Liverpool trade best.** They have the biggest gain on players sold (+€479m) and the
  lowest net spend apart from Tottenham.
- **Man United are the only club that lost money on the fees of the players they sold**
  (−€114m), and they sit level with City for the highest net spend.

## Pipeline

```
Transfermarkt CSV ──► extract ──► spend ──► sales ──┐
(pinned commit)                                     ├──► validate ──► serve ──► docs/assets/big6-data.js
curated CSVs ─────────────────► reference ──────────┘                          (static d3 dashboard)
(press round-ups, accounts, trophies, wages, managers)
```

| Step | Script | What it does |
|---|---|---|
| extract | `extract_transfers.py` | Downloads `premier-league.csv` from ewenme/transfers at a pinned commit, checks its SHA-256, keeps the six clubs' moves. |
| spend | `build_spend.py` | Labels each incoming move (transfer, loan, free, undisclosed). Drops loan returns and academy promotions. Adds the 2023 to 2026 windows from press round-ups, converts pounds to euros at the yearly average rate, and totals spend per club and season. |
| sales | `build_sales.py` | The same for outgoing moves. Then matches every sale to the club's latest permanent signing of the player, using normalised names and an alias table for spelling differences, to get what he cost and the gain. Players who came through the youth teams cost nothing. |
| reference | `build_reference.py` | Loads the hand-collected tables (competitions, league finishes, wage bills, top earners, managers, pay, revenue, accounts profit, source lists) against a typed schema. A bad club name, season or value stops the build with the file and line number. |
| validate | `validate.py` | Eight kinds of check across all 17 output tables: unique keys, every row's source resolves to a listed source, fees in a sane range, season totals equal the sum of their rows, sales reconcile with spend, gain = fee − cost, a complete club × season grid, and sensible values (league positions 1–20, revenue parts add up). Any failure stops the pipeline before the dashboard data is rewritten. |
| serve | `build_dashboard_data.py` | Writes the tables in column-wise form (about half the size of row objects) to `docs/assets/big6-data.js`. |

Run it all with:

```bash
python pipeline/big6/run_pipeline.py            # downloads the pinned source on first run
python pipeline/big6/run_pipeline.py --source path/to/premier-league.csv
```

It needs only the Python 3.9+ standard library and takes about a second. The rebuild is
deterministic: the committed `data/big6/processed/` tables come out identical every run.

## Data model

All money is in millions unless the column name says otherwise. A season is a summer window
plus the January after it. 2026/27 means the summer 2026 window only.

| Table | Grain | Key columns |
|---|---|---|
| `signings` | one incoming move | club, season, window, player, from, fee_eur, fee_gbp_reported, type, src |
| `sales` | one outgoing move | club, season, window, player, to, fee_eur, type, origin, cost_eur, joined, gain_eur, src |
| `totals` | club × season | spend_eur_m, paid_signings, signings |
| `sales_totals` | club × season | sales_eur_m, sales_count, spend_eur_m, net_spend_eur_m |
| `sales_profit` | club × season | profit_gbp_m (profit on disposal of players, from the accounts) |
| `competitions` | club × season × competition | stage reached, games, won |
| `league_positions` | club × season | position, final |
| `wages` | club × season | wages_gbp_m, revenue_gbp_m (staff costs and revenue from the accounts) |
| `top_earners` | club × season × rank | player, weekly_gbp |
| `managers`, `manager_pay` | spell / reported figure | from, to, role; pay_gbp_m, basis |
| `city_revenue` | season | matchday, broadcasting, commercial (€m) |
| `*_sources` | source | name, what it covers, url |

The dashboard works out everything else from these, such as ranks, shares and net figures.
Each tab ends with its sources and method.

## Limitations

- **Fees are estimates.** Clubs rarely publish them. Transfermarkt's figures cover up to
  2022/23. Later fees are as reported in the press and often include potential add-ons.
- **Fee gain is not profit.** It ignores wages, agents' fees, sell-on clauses and how long
  the player stayed. The accounts figure (profit on disposal) is a different measure. It
  spreads each purchase fee over the contract, so a player sold for less than he cost can
  still show a profit.
- **Player wages are published estimates** (Capology and SalaryLeaks), not club figures.
  Wage bills are total staff costs from the accounts, so they include non-playing staff.
- **Gaps are left as gaps.** For example, Tottenham's 2009/10 and 2012/13 wage bills and
  some years of accounts profit were not found. They show as blanks and are not estimated.
- **Name matching is rule-based.** 597 of the 632 paid sales (94.5%) match a purchase or
  academy record directly. The other 35 are all 2023 to 2026 sales of youth players whose
  promotion Transfermarkt never logged, such as McAtee, Bobb and Quansah. The pipeline treats
  them as academy graduates, and a code comment explains why.

## Sources

The raw transfer history is [ewenme/transfers](https://github.com/ewenme/transfers)
(Transfermarkt data, pinned to commit `b531325`). It is downloaded at build time, not
redistributed here. Every curated table has a `src` column keyed to `data/big6/curated/sources_*.csv`,
which lists the article, report or page each figure came from, with links. The dashboard
shows the same lists on each tab.

## Built with

Python (standard library only) · d3.js v7 · HTML/CSS · GitHub Pages. Research and code were
done with help from Claude, an AI assistant. Every figure traces to the source listed next
to it, and the validation step checks that it does.
