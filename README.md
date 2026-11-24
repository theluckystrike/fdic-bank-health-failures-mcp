# fdic-bank-health-failures-mcp

Live FDIC bank health, quarterly Call Report financials, deposit insurance verification, and bank failure tracker for AI assistants. Reads directly from the official FDIC BankFind Suite API (`api.fdic.gov/banks/`) at call time with no API key required.

Ask whether a bank is FDIC-insured, check its latest Tier 1 leverage ratio and estimated uninsured deposit exposure, compare counterparty banks side by side, or track recent FDIC bank failures.

## Tools

| Tool | What it returns |
| --- | --- |
| `fdic_bank_search` | Search FDIC-insured US banks by name, CERT number, state, city, ZIP code, active/inactive status, or minimum assets. Returns CERT, charter type, assets, deposits, ROA, ROE, domestic offices, and FDIC BankFind URL. |
| `fdic_bank_health` | Quarterly Call Report financial health profile for one bank (by CERT or name): total assets, deposits, estimated uninsured deposits %, core deposits %, Tier 1 leverage ratio, equity-to-assets, ROA, ROE, net interest margin, efficiency ratio, noncurrent loans %, automated risk flags, and multi-quarter history. |
| `fdic_bank_failures` | Official FDIC failed bank list (1934 to today), filterable by year range, state, or bank name, with assets and deposits at failure, estimated Deposit Insurance Fund (DIF) cost, and resolution type. |
| `fdic_bank_compare` | Side-by-side comparison of 2 to 5 FDIC-insured banks across assets, Tier 1 leverage, estimated uninsured deposits %, ROA, ROE, net interest margin, efficiency ratio, and noncurrent loans %, naming the leader on each metric. |

Every result includes structured JSON, a plain-text summary, `as_of`, `source`, and `more`. Every tool is marked read-only.

## Install

### Hosted (free, keyless Streamable HTTP)

Paste this URL into Claude, ChatGPT developer mode, or any remote MCP client. No token, no sign-up:

```
https://fdic-bank-health-failures-mcp.lipmichal.workers.dev/mcp
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "fdic-bank-health": {
      "url": "https://fdic-bank-health-failures-mcp.lipmichal.workers.dev/mcp"
    }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "fdic-bank-health": {
      "type": "http",
      "url": "https://fdic-bank-health-failures-mcp.lipmichal.workers.dev/mcp"
    }
  }
}
```

### Local stdio

```bash
git clone https://github.com/theluckystrike/fdic-bank-health-failures-mcp
cd fdic-bank-health-failures-mcp
npm install && npm run build
node dist/stdio.js
```

## Example prompts

- "Check the latest FDIC Call Report health metrics and uninsured deposit share for JPMorgan Chase (CERT 628)."
- "Which US banks have failed since 2023, and what were their assets and estimated FDIC DIF cost?"
- "Compare JPMorgan Chase, Bank of America, and Citibank side by side on Tier 1 leverage, ROA, and uninsured deposits."
- "Find the largest active FDIC-insured banks headquartered in Texas."

## Upgrade & Commercial MCP Services

- **Zovo Pro MCP Bundle ($39 lifetime):** Unlock the full suite of commercial MCP servers with priority hosted endpoints at [mcp.zovo.one/bundle](https://mcp.zovo.one/bundle?src=sat.fdic-bank-health-failures-mcp).
- **Custom MCP Audit & Build Services:** Need a private, production-hardened MCP server for your fintech, treasury, or enterprise stack? Book an audit or custom build at [mcpstamp.com/services](https://www.mcpstamp.com/services/?src=sat.fdic-bank-health-failures-mcp).
- **More Free Live-Data MCP Servers:** Browse the full directory at [mcpstamp.com/free-servers](https://www.mcpstamp.com/free-servers/?utm_source=mcp&utm_medium=fdic-bank-health-failures-mcp).

## Data sources

Full list in [DATA_SOURCES.md](DATA_SOURCES.md).

- FDIC BankFind Suite API (`https://api.fdic.gov/banks/institutions`, `/financials`, `/failures`) — public domain US federal data, no API key required.

## License

MIT
