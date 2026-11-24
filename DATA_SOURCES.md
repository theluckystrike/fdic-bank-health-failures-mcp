# Data Sources

All data is fetched live at call time from the official Federal Deposit Insurance Corporation (FDIC) BankFind Suite public API. No API key is required.

- **Institutions Directory:** `https://api.fdic.gov/banks/institutions` — active and inactive FDIC-insured financial institutions, headquarters, charter class, and latest summary totals.
- **Quarterly Call Report Financials:** `https://api.fdic.gov/banks/financials` — quarterly balance sheet, income statement, capital ratios (`RBC1AAJ`, `RBCT1J`), insured deposits (`DEPINS`), core deposits (`COREDEP`), and asset quality (`NCLNLS`, `LNLSNET`). Dollar figures from FDIC are reported in thousands of USD (`$K`).
- **Failed Bank List:** `https://api.fdic.gov/banks/failures` — historical and current FDIC bank failures, assets/deposits at failure, and estimated Deposit Insurance Fund (DIF) cost.
