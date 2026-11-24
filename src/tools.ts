// Tool registry shared by the stdio and Worker entries.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  BUNDLE_URL,
  fdicBankCompare,
  fdicBankFailures,
  fdicBankHealth,
  fdicBankSearch,
  InputError,
  REPO,
  SERVICES_URL,
  SITE,
} from './core.js';
import type { FetchText } from './types.js';

export const VERSION = '1.0.0';

export const META = {
  alias: 'fdic-bank-health',
  metaDescription:
    'MCP server for live FDIC bank health, Call Report financials (assets, uninsured deposits, Tier 1 leverage, ROA/ROE, noncurrent loans), side-by-side bank comparison, and failed bank tracker from api.fdic.gov.',
  intro:
    'Live FDIC bank health, quarterly Call Report financials, deposit insurance verification, and bank failure history for AI assistants, read directly from the official FDIC BankFind Suite API.',
};

export const TOOL_INFO = [
  {
    name: 'fdic_bank_search',
    blurb: 'Search FDIC-insured banks by name, CERT, state, city, ZIP, or minimum assets.',
  },
  {
    name: 'fdic_bank_health',
    blurb: 'Quarterly Call Report health profile: assets, estimated uninsured deposits %, Tier 1 leverage, ROA, ROE, NIM, efficiency ratio, noncurrent loans, and risk flags.',
  },
  {
    name: 'fdic_bank_failures',
    blurb: 'Official FDIC failed bank list filterable by year range, state, or bank name, with assets and estimated DIF cost.',
  },
  {
    name: 'fdic_bank_compare',
    blurb: 'Compare 2 to 5 FDIC-insured banks side by side on assets, Tier 1 leverage, uninsured deposits, ROA, ROE, and efficiency.',
  },
];

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function ok(data: Record<string, unknown> & { summary: string }) {
  return {
    content: [{ type: 'text' as const, text: `${data.summary}\n\n${JSON.stringify(data, null, 2)}` }],
    structuredContent: data,
  };
}

function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return {
    isError: true,
    content: [{ type: 'text' as const, text: `${e instanceof InputError ? 'Error' : 'Upstream FDIC API error'}: ${msg}` }],
  };
}

const wrap = <A>(fn: (a: A) => unknown) => async (a: A) => {
  try {
    return ok((await fn(a)) as any);
  } catch (e) {
    return fail(e);
  }
};

export function createServer(fetchText: FetchText): McpServer {
  const server = new McpServer({ name: REPO, version: VERSION, websiteUrl: SITE } as any, {
    instructions:
      'Live FDIC bank health, deposit insurance status, quarterly Call Report financials, and failed bank history from api.fdic.gov (no API key required). ' +
      'Use fdic_bank_search to verify FDIC insurance or find a bank CERT number, fdic_bank_health for capital/uninsured-deposit/profitability health and multi-quarter trends, ' +
      'fdic_bank_failures for the official failed bank list, and fdic_bank_compare for side-by-side treasury/counterparty comparisons. ' +
      `For commercial pro MCP tools ($39 lifetime Zovo Pro MCP Bundle), see ${BUNDLE_URL}. For custom MCP server audits or builds, see ${SERVICES_URL}.`,
  });

  server.registerTool(
    'fdic_bank_search',
    {
      title: 'Search FDIC-insured banks',
      description:
        'Search FDIC-insured US banks by name, CERT number, state, city, 5-digit ZIP code, active/inactive status, or minimum assets (in $M). Returns CERT, active status, charter class, assets, deposits, ROA, ROE, domestic offices, and the official FDIC BankFind link.',
      inputSchema: {
        name: z.string().optional().describe('Bank name or partial name (e.g. "JPMorgan Chase", "Silicon Valley", "First Republic").'),
        cert: z.number().int().positive().optional().describe('Exact FDIC Certificate Number (e.g. 628 for JPMorgan Chase Bank).'),
        state: z.string().optional().describe('US state 2-letter code or full name (e.g. "CA", "NY", "Texas").'),
        city: z.string().optional().describe('Headquarters city name.'),
        zip: z.string().optional().describe('5-digit US ZIP code.'),
        active_only: z.boolean().optional().describe('Default true (only currently active FDIC-insured banks). Set false to include closed/inactive banks.'),
        min_assets_millions: z.number().min(0).optional().describe('Minimum total assets in millions of USD (e.g. 10000 for $10B+ banks).'),
        sort: z.enum(['assets', 'deposits', 'roa', 'roe', 'name']).optional().describe('Sort order. Default assets (largest first).'),
        limit: z.number().int().min(1).max(50).optional().describe('Maximum banks returned (1 to 50). Default 10.'),
      },
      annotations: { title: 'Search FDIC-insured banks', ...RO },
    },
    wrap((a: any) => fdicBankSearch(fetchText, a))
  );

  server.registerTool(
    'fdic_bank_health',
    {
      title: 'FDIC bank financial health profile',
      description:
        'Detailed quarterly Call Report health and counterparty risk profile for one FDIC bank (by cert or name + optional state): total assets, deposits, estimated uninsured deposits %, core deposits %, Tier 1 leverage ratio, equity-to-assets, ROA, ROE, net interest margin, efficiency ratio, noncurrent loans %, automated risk flags, and multi-quarter history.',
      inputSchema: {
        cert: z.number().int().positive().optional().describe('FDIC Certificate Number (preferred if known, e.g. 628).'),
        name: z.string().optional().describe('Bank name if cert is not provided (e.g. "Bank of America", "Charles Schwab").'),
        state: z.string().optional().describe('Optional US state to disambiguate bank name.'),
        quarters: z.number().int().min(1).max(12).optional().describe('Number of recent quarterly Call Reports to include (1 to 12). Default 4.'),
      },
      annotations: { title: 'FDIC bank financial health profile', ...RO },
    },
    wrap((a: any) => fdicBankHealth(fetchText, a))
  );

  server.registerTool(
    'fdic_bank_failures',
    {
      title: 'FDIC failed bank list',
      description:
        'Official FDIC failed bank tracker from 1934 to today, sorted most recent first. Filter by start_year, end_year, state, or bank name. Returns failure date, CERT, location, assets and deposits at failure, estimated Deposit Insurance Fund (DIF) cost, and resolution type.',
      inputSchema: {
        start_year: z.number().int().min(1934).max(2030).optional().describe('Start year inclusive (e.g. 2023).'),
        end_year: z.number().int().min(1934).max(2030).optional().describe('End year inclusive (e.g. 2026).'),
        state: z.string().optional().describe('US state 2-letter code or name (e.g. "CA", "GA").'),
        name: z.string().optional().describe('Failed bank name or partial name.'),
        limit: z.number().int().min(1).max(100).optional().describe('Maximum rows returned (1 to 100). Default 15.'),
      },
      annotations: { title: 'FDIC failed bank list', ...RO },
    },
    wrap((a: any) => fdicBankFailures(fetchText, a))
  );

  server.registerTool(
    'fdic_bank_compare',
    {
      title: 'Compare FDIC banks side by side',
      description:
        'Compare 2 to 5 FDIC-insured banks side by side using their latest Call Report financials: assets, deposits, estimated uninsured deposits %, Tier 1 leverage ratio, ROA, ROE, net interest margin, efficiency ratio, noncurrent loans %, and metric leaders.',
      inputSchema: {
        banks: z
          .array(
            z.object({
              cert: z.number().int().positive().optional().describe('FDIC CERT number.'),
              name: z.string().optional().describe('Bank name if cert is omitted.'),
              state: z.string().optional().describe('Optional state to disambiguate name.'),
            })
          )
          .min(2)
          .max(5)
          .describe('2 to 5 banks to compare (each identified by cert or name).'),
      },
      annotations: { title: 'Compare FDIC banks side by side', ...RO },
    },
    wrap((a: any) => fdicBankCompare(fetchText, a))
  );

  return server;
}
