import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fdicBankCompare,
  fdicBankFailures,
  fdicBankHealth,
  fdicBankSearch,
  fmtThousandsUsd,
  InputError,
  normalizeState,
} from '../dist/core.js';

const MOCK_INST = {
  meta: { total: 1, index: { createTimestamp: '2026-11-24T18:30:22Z' } },
  data: [
    {
      data: {
        NAME: 'JPMorgan Chase Bank, National Association',
        CERT: 628,
        ACTIVE: 1,
        CITY: 'Columbus',
        STALP: 'OH',
        ZIP: '43240',
        ASSET: 4174631000,
        DEP: 2901316000,
        EQ: 331583000,
        ROA: 1.48,
        ROE: 17.64,
        NETINC: 44485000,
        OFFDOM: 5205,
        ESTYMD: '01/01/1824',
        BKCLASS: 'N',
        WEBADDR: 'www.jpmorganchase.com',
        SPECGRPN: 'International Specialization',
        REPDTE: '09/30/2026',
      },
    },
  ],
};

const MOCK_FIN = {
  meta: { total: 2, index: { createTimestamp: '2026-11-19T16:41:28Z' } },
  data: [
    {
      data: {
        CERT: 628,
        NAME: 'JPMORGAN CHASE BANK NA',
        REPDTE: '20260930',
        ASSET: 4174631000,
        DEP: 2901316000,
        DEPINS: 905857000,
        COREDEP: 2028871000,
        EQ: 331583000,
        NETINC: 44485000,
        ROA: 1.48,
        ROE: 17.64,
        NIMY: 2.9,
        EEFFR: 54.63,
        RBC1AAJ: 7.24,
        RBCT1J: 296414000,
        LNLSNET: 1582013000,
        NCLNLS: 12202000,
      },
    },
  ],
};

const MOCK_FAIL = {
  meta: { total: 1, index: { createTimestamp: '2026-11-24T15:16:13Z' } },
  data: [
    {
      data: {
        NAME: 'SMALL BUSINESS BANK',
        CERT: 25744,
        CITYST: 'LENEXA, KS',
        FAILDATE: '7/17/2026',
        COST: 5671,
        QBFASSET: 72947,
        QBFDEP: 68773,
        RESTYPE: 'FAILURE',
        SAVR: 'DIF',
        CHCLASS1: 'SM',
      },
    },
  ],
};

const fakeFetch = async (url) => {
  if (url.includes('/institutions?')) return JSON.stringify(MOCK_INST);
  if (url.includes('/financials?')) return JSON.stringify(MOCK_FIN);
  if (url.includes('/failures?')) return JSON.stringify(MOCK_FAIL);
  throw new Error(`unexpected url: ${url}`);
};

test('formatting and state normalization', () => {
  assert.equal(fmtThousandsUsd(4174631000), '$4174.63B');
  assert.equal(fmtThousandsUsd(72947), '$72.9M');
  assert.equal(fmtThousandsUsd(500), '$500K');
  assert.equal(normalizeState('California'), 'CA');
  assert.equal(normalizeState('ny'), 'NY');
  assert.throws(() => normalizeState('Atlantis'), InputError);
});

test('fdicBankSearch parses institution response cleanly', async () => {
  const res = await fdicBankSearch(fakeFetch, { name: 'JPMorgan Chase', state: 'OH' });
  assert.equal(res.total_matches, 1);
  assert.equal(res.banks[0].cert, 628);
  assert.equal(res.banks[0].active, true);
  assert.equal(res.banks[0].report_date, '2026-09-30');
});

test('fdicBankHealth computes uninsured deposits % and flags', async () => {
  const res = await fdicBankHealth(fakeFetch, { cert: 628, quarters: 1 });
  assert.equal(res.bank.cert, 628);
  assert.equal(res.latest_quarter.report_date, '2026-09-30');
  assert.ok(res.latest_quarter.estimated_uninsured_deposits_pct > 60);
  assert.ok(res.risk_flags.some((f) => f.includes('uninsured deposits')));
});

test('fdicBankFailures parses failure rows and totals', async () => {
  const res = await fdicBankFailures(fakeFetch, { start_year: 2026, end_year: 2026 });
  assert.equal(res.failures.length, 1);
  assert.equal(res.failures[0].fail_date, '2026-07-17');
  assert.equal(res.failures[0].assets_formatted, '$72.9M');
});

test('fdicBankCompare validates bank count and produces leaders', async () => {
  await assert.rejects(fdicBankCompare(fakeFetch, { banks: [{ cert: 628 }] }), InputError);
  const res = await fdicBankCompare(fakeFetch, { banks: [{ cert: 628 }, { cert: 628 }] });
  assert.equal(res.banks.length, 2);
  assert.equal(res.leaders.largest_assets.cert, 628);
});
