// Core FDIC BankFind Suite API logic (institutions, financials, failures).
import type { FetchText } from './types.js';

export const REPO = 'fdic-bank-health-failures-mcp';
export const SITE = 'https://www.mcpstamp.com';
export const UTM = `utm_source=mcp&utm_medium=${REPO}`;
export const BUNDLE_URL = `https://mcp.zovo.one/bundle?src=sat.${REPO}`;
export const SERVICES_URL = `https://www.mcpstamp.com/services/?src=sat.${REPO}`;
export const MORE_URL = `${SITE}/free-servers/?${UTM}`;
export const FDIC_API = 'https://api.fdic.gov/banks';

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

const US_STATES: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
  COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', 'DISTRICT OF COLUMBIA': 'DC',
  FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL',
  INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA',
  MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN',
  MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK',
  OREGON: 'OR', PENNSYLVANIA: 'PA', 'PUERTO RICO': 'PR', 'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX',
  UTAH: 'UT', VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI', WYOMING: 'WY',
};

const VALID_STATE_CODES = new Set(Object.values(US_STATES));

export function normalizeState(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toUpperCase();
  if (!s) return undefined;
  if (VALID_STATE_CODES.has(s)) return s;
  if (US_STATES[s]) return US_STATES[s];
  throw new InputError(`Unrecognized US state: "${raw}". Use a 2-letter code like "CA", "NY", "TX" or a full state name.`);
}

const CHARTER_LABELS: Record<string, string> = {
  N: 'National Bank (OCC)',
  SM: 'State Member Bank (Fed)',
  NM: 'State Nonmember Bank (FDIC)',
  SB: 'Federal Savings Bank',
  SA: 'Savings Association',
  OI: 'Insured US Branch of Foreign Bank',
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(n: number | null, digits = 2): number | null {
  if (n === null) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** FDIC reports dollar figures in thousands ($K). Format $K cleanly as $B / $M / $K. */
export function fmtThousandsUsd(k: number | null): string {
  if (k === null) return 'n/a';
  const sign = k < 0 ? '-' : '';
  const abs = Math.abs(k);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}B`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}M`;
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}K`;
}

function fmtPct(v: number | null): string {
  return v === null ? 'n/a' : `${v.toFixed(2)}%`;
}

function escLucene(s: string): string {
  return s.replace(/["\\]/g, ' ').trim();
}

function formatRepDate(raw?: string): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [m, d, y] = s.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return s;
}

function bankfindUrl(cert: number): string {
  return `https://banks.data.fdic.gov/bankfind-suite/bankfind/details/${cert}`;
}

interface FdicResponse<T> {
  meta?: { total?: number; index?: { createTimestamp?: string } };
  data?: Array<{ data: T; score?: number }>;
}

async function fdicGet<T>(fetchText: FetchText, path: string, params: Record<string, string>, cacheTtl = 1800): Promise<FdicResponse<T>> {
  const qs = new URLSearchParams(params).toString();
  const url = `${FDIC_API}/${path}?${qs}`;
  const raw = await fetchText(url, { cacheTtl });
  let parsed: FdicResponse<T>;
  try {
    parsed = JSON.parse(raw) as FdicResponse<T>;
  } catch {
    throw new Error('FDIC API returned invalid JSON');
  }
  return parsed;
}

const INST_FIELDS = [
  'NAME', 'CERT', 'ACTIVE', 'CITY', 'STALP', 'ZIP', 'ASSET', 'DEP', 'EQ',
  'ROA', 'ROE', 'NETINC', 'OFFDOM', 'ESTYMD', 'BKCLASS', 'WEBADDR', 'SPECGRPN', 'REPDTE',
].join(',');

export interface BankSearchArgs {
  name?: string;
  cert?: number;
  state?: string;
  city?: string;
  zip?: string;
  active_only?: boolean;
  min_assets_millions?: number;
  sort?: 'assets' | 'deposits' | 'roa' | 'roe' | 'name';
  limit?: number;
}

export async function fdicBankSearch(fetchText: FetchText, args: BankSearchArgs) {
  const filters: string[] = [];
  if (args.active_only !== false) filters.push('ACTIVE:1');
  if (args.cert !== undefined) {
    if (!Number.isInteger(args.cert) || args.cert <= 0) throw new InputError('cert must be a positive integer.');
    filters.push(`CERT:${args.cert}`);
  }
  const st = normalizeState(args.state);
  if (st) filters.push(`STALP:${st}`);
  if (args.city?.trim()) filters.push(`CITY:"${escLucene(args.city)}"`);
  if (args.zip?.trim()) {
    const z = args.zip.trim().replace(/[^0-9]/g, '').slice(0, 5);
    if (z.length !== 5) throw new InputError('zip must be a 5-digit US ZIP code.');
    filters.push(`ZIP:${z}`);
  }
  if (args.min_assets_millions !== undefined) {
    const minK = Math.max(0, Math.round(args.min_assets_millions * 1000));
    filters.push(`ASSET:[${minK} TO *]`);
  }

  const sortMap: Record<string, { by: string; order: string }> = {
    assets: { by: 'ASSET', order: 'DESC' },
    deposits: { by: 'DEP', order: 'DESC' },
    roa: { by: 'ROA', order: 'DESC' },
    roe: { by: 'ROE', order: 'DESC' },
    name: { by: 'NAME', order: 'ASC' },
  };
  const sortCfg = sortMap[args.sort ?? 'assets'] ?? sortMap.assets;
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);

  const params: Record<string, string> = {
    fields: INST_FIELDS,
    limit: String(limit),
    sort_by: sortCfg.by,
    sort_order: sortCfg.order,
  };
  if (filters.length > 0) params.filters = filters.join(' AND ');
  if (args.name?.trim()) params.search = `NAME:"${escLucene(args.name)}"`;

  const resp = await fdicGet<Record<string, unknown>>(fetchText, 'institutions', params, 1800);
  const rows = (resp.data ?? []).map(({ data: d }) => {
    const cert = Number(d.CERT);
    const assetK = num(d.ASSET);
    const depK = num(d.DEP);
    const eqK = num(d.EQ);
    const netincK = num(d.NETINC);
    const bkclass = String(d.BKCLASS ?? '');
    return {
      cert,
      name: String(d.NAME ?? ''),
      active: Number(d.ACTIVE) === 1,
      city: String(d.CITY ?? ''),
      state: String(d.STALP ?? ''),
      zip: String(d.ZIP ?? ''),
      charter_class: bkclass,
      charter_type: CHARTER_LABELS[bkclass] ?? bkclass,
      specialization: String(d.SPECGRPN ?? ''),
      established: d.ESTYMD ? String(d.ESTYMD) : null,
      domestic_offices: num(d.OFFDOM),
      report_date: formatRepDate(d.REPDTE as string | undefined),
      assets_usd_thousands: assetK,
      assets_formatted: fmtThousandsUsd(assetK),
      deposits_usd_thousands: depK,
      deposits_formatted: fmtThousandsUsd(depK),
      equity_usd_thousands: eqK,
      net_income_usd_thousands: netincK,
      roa_pct: round(num(d.ROA)),
      roe_pct: round(num(d.ROE)),
      website: d.WEBADDR ? String(d.WEBADDR) : null,
      fdic_url: bankfindUrl(cert),
    };
  });

  const total = resp.meta?.total ?? rows.length;
  const topLines = rows.slice(0, 5).map(
    (b) => `- ${b.name} (CERT ${b.cert}, ${b.city}, ${b.state}, ${b.active ? 'Active' : 'Inactive'}): Assets ${b.assets_formatted}, Deposits ${b.deposits_formatted}, ROA ${fmtPct(b.roa_pct)}, ROE ${fmtPct(b.roe_pct)}`
  );
  const summary = rows.length === 0
    ? 'No FDIC institutions matched your search filters.'
    : `Found ${total.toLocaleString('en-US')} FDIC institution(s) (showing ${rows.length}):\n${topLines.join('\n')}`;

  return {
    summary,
    total_matches: total,
    returned: rows.length,
    banks: rows,
    as_of: resp.meta?.index?.createTimestamp ?? new Date().toISOString(),
    source: 'FDIC BankFind Suite Institutions API (api.fdic.gov/banks/institutions)',
    more: MORE_URL,
  };
}

const FIN_FIELDS = [
  'CERT', 'NAME', 'REPDTE', 'ASSET', 'DEP', 'DEPINS', 'COREDEP', 'EQ',
  'NETINC', 'ROA', 'ROE', 'NIMY', 'EEFFR', 'RBC1AAJ', 'RBCT1J', 'LNLSNET', 'NCLNLS',
].join(',');

export interface BankHealthArgs {
  cert?: number;
  name?: string;
  state?: string;
  quarters?: number;
}

async function resolveBankCert(fetchText: FetchText, args: { cert?: number; name?: string; state?: string }): Promise<{ cert: number; inst: Record<string, unknown> | null }> {
  if (args.cert !== undefined) {
    if (!Number.isInteger(args.cert) || args.cert <= 0) throw new InputError('cert must be a positive integer.');
    const r = await fdicGet<Record<string, unknown>>(fetchText, 'institutions', {
      filters: `CERT:${args.cert}`,
      fields: INST_FIELDS,
      limit: '1',
    }, 1800);
    return { cert: args.cert, inst: r.data?.[0]?.data ?? null };
  }
  if (!args.name?.trim()) {
    throw new InputError('Provide either a bank cert number (e.g. 628) or a bank name (e.g. "JPMorgan Chase").');
  }
  const st = normalizeState(args.state);
  const params: Record<string, string> = {
    search: `NAME:"${escLucene(args.name)}"`,
    fields: INST_FIELDS,
    limit: '5',
    sort_by: 'ASSET',
    sort_order: 'DESC',
  };
  if (st) params.filters = `STALP:${st}`;
  const r = await fdicGet<Record<string, unknown>>(fetchText, 'institutions', params, 1800);
  const first = r.data?.[0]?.data;
  if (!first) throw new InputError(`No FDIC bank found matching "${args.name}"${st ? ` in ${st}` : ''}.`);
  return { cert: Number(first.CERT), inst: first };
}

function parseQuarter(d: Record<string, unknown>) {
  const assetK = num(d.ASSET);
  const depK = num(d.DEP);
  const depInsK = num(d.DEPINS);
  const coreDepK = num(d.COREDEP);
  const eqK = num(d.EQ);
  const loansK = num(d.LNLSNET);
  const nclK = num(d.NCLNLS);

  const uninsuredPct = depK && depK > 0 && depInsK !== null
    ? round(Math.max(0, ((depK - depInsK) / depK) * 100))
    : null;
  const coreDepPct = depK && depK > 0 && coreDepK !== null
    ? round((coreDepK / depK) * 100)
    : null;
  const eqToAssetsPct = assetK && assetK > 0 && eqK !== null
    ? round((eqK / assetK) * 100)
    : null;
  const noncurrentLoansPct = loansK && loansK > 0 && nclK !== null
    ? round((nclK / loansK) * 100)
    : null;

  return {
    report_date: formatRepDate(d.REPDTE as string | undefined),
    assets_usd_thousands: assetK,
    assets_formatted: fmtThousandsUsd(assetK),
    deposits_usd_thousands: depK,
    deposits_formatted: fmtThousandsUsd(depK),
    insured_deposits_usd_thousands: depInsK,
    estimated_uninsured_deposits_pct: uninsuredPct,
    core_deposits_pct: coreDepPct,
    equity_usd_thousands: eqK,
    equity_to_assets_pct: eqToAssetsPct,
    tier1_leverage_ratio_pct: round(num(d.RBC1AAJ)),
    tier1_capital_usd_thousands: num(d.RBCT1J),
    net_income_usd_thousands: num(d.NETINC),
    roa_pct: round(num(d.ROA)),
    roe_pct: round(num(d.ROE)),
    net_interest_margin_pct: round(num(d.NIMY)),
    efficiency_ratio_pct: round(num(d.EEFFR)),
    net_loans_usd_thousands: loansK,
    noncurrent_loans_usd_thousands: nclK,
    noncurrent_loans_pct: noncurrentLoansPct,
  };
}

export async function fdicBankHealth(fetchText: FetchText, args: BankHealthArgs) {
  const { cert, inst } = await resolveBankCert(fetchText, args);
  const quarters = Math.min(Math.max(args.quarters ?? 4, 1), 12);

  const fin = await fdicGet<Record<string, unknown>>(fetchText, 'financials', {
    filters: `CERT:${cert}`,
    fields: FIN_FIELDS,
    limit: String(quarters),
    sort_by: 'REPDTE',
    sort_order: 'DESC',
  }, 1800);

  const history = (fin.data ?? []).map(({ data }) => parseQuarter(data));
  if (history.length === 0) {
    throw new InputError(`No FDIC Call Report financials found for CERT ${cert}.`);
  }

  const latest = history[0];
  const name = String(inst?.NAME ?? fin.data?.[0]?.data?.NAME ?? `CERT ${cert}`);
  const active = inst ? Number(inst.ACTIVE) === 1 : null;
  const city = inst ? String(inst.CITY ?? '') : null;
  const state = inst ? String(inst.STALP ?? '') : null;

  const riskFlags: string[] = [];
  if (active === false) riskFlags.push('Institution is currently INACTIVE in FDIC records.');
  if (latest.tier1_leverage_ratio_pct !== null && latest.tier1_leverage_ratio_pct < 5) {
    riskFlags.push(`Tier 1 leverage ratio (${latest.tier1_leverage_ratio_pct}%) is below the 5% well-capitalized benchmark.`);
  }
  if (latest.estimated_uninsured_deposits_pct !== null && latest.estimated_uninsured_deposits_pct > 50) {
    riskFlags.push(`Estimated uninsured deposits (${latest.estimated_uninsured_deposits_pct}%) exceed 50% of total deposits.`);
  }
  if (latest.noncurrent_loans_pct !== null && latest.noncurrent_loans_pct > 2) {
    riskFlags.push(`Noncurrent loans (${latest.noncurrent_loans_pct}% of net loans) exceed 2%.`);
  }
  if (latest.roa_pct !== null && latest.roa_pct < 0) {
    riskFlags.push(`Negative Return on Assets (${latest.roa_pct}%).`);
  }

  const loc = city && state ? `${city}, ${state}` : 'US';
  const summary =
    `${name} (CERT ${cert}, ${loc}, ${active === false ? 'Inactive' : 'Active FDIC-Insured'}) as of ${latest.report_date}: ` +
    `Assets ${latest.assets_formatted}, Deposits ${latest.deposits_formatted} (${fmtPct(latest.estimated_uninsured_deposits_pct)} est. uninsured), ` +
    `Tier 1 Leverage ${fmtPct(latest.tier1_leverage_ratio_pct)}, ROA ${fmtPct(latest.roa_pct)}, ROE ${fmtPct(latest.roe_pct)}, ` +
    `NIM ${fmtPct(latest.net_interest_margin_pct)}, Efficiency ${fmtPct(latest.efficiency_ratio_pct)}, Noncurrent Loans ${fmtPct(latest.noncurrent_loans_pct)}.` +
    (riskFlags.length > 0 ? ` Flags: ${riskFlags.join(' ')}` : ' No capital or asset-quality flags triggered.');

  return {
    summary,
    bank: {
      cert,
      name,
      active,
      city,
      state,
      charter_type: inst ? (CHARTER_LABELS[String(inst.BKCLASS ?? '')] ?? String(inst.BKCLASS ?? '')) : null,
      website: inst?.WEBADDR ? String(inst.WEBADDR) : null,
      fdic_url: bankfindUrl(cert),
    },
    latest_quarter: latest,
    risk_flags: riskFlags,
    quarterly_history: history,
    as_of: fin.meta?.index?.createTimestamp ?? new Date().toISOString(),
    source: 'FDIC BankFind Suite Call Report Financials API (api.fdic.gov/banks/financials)',
    more: MORE_URL,
  };
}

export interface BankFailuresArgs {
  start_year?: number;
  end_year?: number;
  state?: string;
  name?: string;
  limit?: number;
}

const FAIL_FIELDS = 'NAME,CERT,CITYST,FAILDATE,COST,QBFASSET,QBFDEP,RESTYPE,SAVR,CHCLASS1';

export async function fdicBankFailures(fetchText: FetchText, args: BankFailuresArgs) {
  const filters: string[] = [];
  if (args.start_year !== undefined || args.end_year !== undefined) {
    const sy = args.start_year ?? 1934;
    const ey = args.end_year ?? new Date().getUTCFullYear();
    if (sy > ey) throw new InputError('start_year cannot be greater than end_year.');
    filters.push(`FAILDATE:[${sy}-01-01 TO ${ey}-12-31]`);
  }
  const st = normalizeState(args.state);
  if (st) filters.push(`PSTALP:${st}`);

  const limit = Math.min(Math.max(args.limit ?? 15, 1), 100);
  const params: Record<string, string> = {
    fields: FAIL_FIELDS,
    limit: String(limit),
    sort_by: 'FAILDATE',
    sort_order: 'DESC',
  };
  if (filters.length > 0) params.filters = filters.join(' AND ');
  if (args.name?.trim()) params.search = `NAME:"${escLucene(args.name)}"`;

  const resp = await fdicGet<Record<string, unknown>>(fetchText, 'failures', params, 1800);
  const rows = (resp.data ?? []).map(({ data: d }) => {
    const assetK = num(d.QBFASSET);
    const depK = num(d.QBFDEP);
    const costK = num(d.COST);
    return {
      name: String(d.NAME ?? ''),
      cert: num(d.CERT),
      city_state: String(d.CITYST ?? ''),
      fail_date: formatRepDate(d.FAILDATE as string | undefined),
      assets_usd_thousands: assetK,
      assets_formatted: fmtThousandsUsd(assetK),
      deposits_usd_thousands: depK,
      deposits_formatted: fmtThousandsUsd(depK),
      estimated_dif_cost_usd_thousands: costK,
      estimated_dif_cost_formatted: fmtThousandsUsd(costK),
      resolution_type: String(d.RESTYPE ?? ''),
      fund: String(d.SAVR ?? ''),
      charter_class: String(d.CHCLASS1 ?? ''),
    };
  });

  const total = resp.meta?.total ?? rows.length;
  const totalAssetsK = rows.reduce((acc, r) => acc + (r.assets_usd_thousands ?? 0), 0);
  const totalCostK = rows.reduce((acc, r) => acc + (r.estimated_dif_cost_usd_thousands ?? 0), 0);

  const lines = rows.slice(0, 6).map(
    (f) => `- ${f.fail_date}: ${f.name} (${f.city_state}, CERT ${f.cert ?? 'n/a'}) — Assets ${f.assets_formatted}, Est. DIF Cost ${f.estimated_dif_cost_formatted}`
  );
  const summary = rows.length === 0
    ? 'No FDIC bank failures matched those filters.'
    : `Found ${total.toLocaleString('en-US')} FDIC bank failure(s) (showing ${rows.length}; combined assets ${fmtThousandsUsd(totalAssetsK)}, est. DIF cost ${fmtThousandsUsd(totalCostK)}):\n${lines.join('\n')}`;

  return {
    summary,
    total_matches: total,
    returned: rows.length,
    shown_combined_assets_formatted: fmtThousandsUsd(totalAssetsK),
    shown_combined_dif_cost_formatted: fmtThousandsUsd(totalCostK),
    failures: rows,
    as_of: resp.meta?.index?.createTimestamp ?? new Date().toISOString(),
    source: 'FDIC BankFind Suite Failures API (api.fdic.gov/banks/failures)',
    more: MORE_URL,
  };
}

export interface BankCompareArgs {
  banks: Array<{ cert?: number; name?: string; state?: string }>;
}

export async function fdicBankCompare(fetchText: FetchText, args: BankCompareArgs) {
  if (!Array.isArray(args.banks) || args.banks.length < 2 || args.banks.length > 5) {
    throw new InputError('Provide between 2 and 5 banks to compare.');
  }

  const profiles = await Promise.all(
    args.banks.map((b) => fdicBankHealth(fetchText, { cert: b.cert, name: b.name, state: b.state, quarters: 1 }))
  );

  const items = profiles.map((p) => ({
    cert: p.bank.cert,
    name: p.bank.name,
    state: p.bank.state,
    active: p.bank.active,
    report_date: p.latest_quarter.report_date,
    assets_usd_thousands: p.latest_quarter.assets_usd_thousands,
    assets_formatted: p.latest_quarter.assets_formatted,
    deposits_formatted: p.latest_quarter.deposits_formatted,
    estimated_uninsured_deposits_pct: p.latest_quarter.estimated_uninsured_deposits_pct,
    tier1_leverage_ratio_pct: p.latest_quarter.tier1_leverage_ratio_pct,
    roa_pct: p.latest_quarter.roa_pct,
    roe_pct: p.latest_quarter.roe_pct,
    net_interest_margin_pct: p.latest_quarter.net_interest_margin_pct,
    efficiency_ratio_pct: p.latest_quarter.efficiency_ratio_pct,
    noncurrent_loans_pct: p.latest_quarter.noncurrent_loans_pct,
    risk_flags: p.risk_flags,
  }));

  const best = <K extends keyof (typeof items)[number]>(key: K, mode: 'max' | 'min') => {
    const valid = items.filter((i) => typeof i[key] === 'number');
    if (valid.length === 0) return null;
    valid.sort((a, b) => (mode === 'max' ? (b[key] as number) - (a[key] as number) : (a[key] as number) - (b[key] as number)));
    return { name: valid[0].name, cert: valid[0].cert, value: valid[0][key] };
  };

  const leaders = {
    largest_assets: best('assets_usd_thousands', 'max'),
    highest_tier1_leverage: best('tier1_leverage_ratio_pct', 'max'),
    lowest_uninsured_deposits_pct: best('estimated_uninsured_deposits_pct', 'min'),
    highest_roa: best('roa_pct', 'max'),
    highest_roe: best('roe_pct', 'max'),
    best_efficiency_ratio: best('efficiency_ratio_pct', 'min'),
  };

  const lines = items.map(
    (b) => `- ${b.name} (CERT ${b.cert}): Assets ${b.assets_formatted}, Tier 1 Lev ${fmtPct(b.tier1_leverage_ratio_pct)}, Est. Uninsured ${fmtPct(b.estimated_uninsured_deposits_pct)}, ROA ${fmtPct(b.roa_pct)}, ROE ${fmtPct(b.roe_pct)}`
  );
  const summary = `Side-by-side FDIC Call Report comparison (${items.length} banks):\n${lines.join('\n')}`;

  return {
    summary,
    banks: items,
    leaders,
    as_of: profiles[0]?.as_of ?? new Date().toISOString(),
    source: 'FDIC BankFind Suite Call Report Financials API (api.fdic.gov/banks/financials)',
    more: MORE_URL,
  };
}
