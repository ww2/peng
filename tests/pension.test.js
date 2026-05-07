// Tests for lib/pension.js — run with `node --test tests/` from repo root.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPaystubStream,
  buildSyntheticStream,
  projectAfcAtRetirement,
  applyRaises,
  blendedBenefit,
  calculateSeries,
  serviceAtMonth,
  primaryEligAge,
  primaryArfAge,
  primaryEligibility,
  primaryARF,
  PLAN_CONFIGS,
  RAISES,
  todayInHST,
} = require('../lib/pension.js');

const stub = (y, m, d1, d2, earnings) => ({
  beginDate: new Date(y, m, d1),
  endDate:   new Date(y, m, d2),
  currentEarnings: earnings,
});

const lastDayOfMonth = (y, m) => new Date(y, m + 1, 0).getDate();

const summarize = (stream) =>
  stream.map(e => ({
    y: e.month.getFullYear(),
    m: e.month.getMonth(),
    regular: e.regular,
    total: e.total,
  }));

// ── todayInHST ───────────────────────────────────────────────────────
// Calendar "today" must be HST regardless of the wall-clock TZ. Tests
// pass the instant explicitly via the helper's optional parameter so they
// don't depend on system TZ.
test('todayInHST', async (t) => {
  await t.test('UTC instant 1 minute before HST midnight → previous calendar day', () => {
    // 2026-05-07 09:59 UTC = 2026-05-06 23:59 HST
    const d = todayInHST(new Date(Date.UTC(2026, 4, 7, 9, 59)));
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 4);
    assert.equal(d.getDate(), 6);
  });
  await t.test('UTC instant at HST midnight → next calendar day', () => {
    // 2026-05-07 10:00 UTC = 2026-05-07 00:00 HST
    const d = todayInHST(new Date(Date.UTC(2026, 4, 7, 10, 0)));
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 4);
    assert.equal(d.getDate(), 7);
  });
  await t.test('returned Date is local midnight (composes with addMonths etc.)', () => {
    const d = todayInHST(new Date(Date.UTC(2026, 4, 7, 9, 59)));
    assert.equal(d.getHours(), 0);
    assert.equal(d.getMinutes(), 0);
    assert.equal(d.getSeconds(), 0);
    assert.equal(d.getMilliseconds(), 0);
  });
  await t.test('month boundary: HST is still in previous month while UTC has rolled', () => {
    // 2026-06-01 05:00 UTC = 2026-05-31 19:00 HST
    const d = todayInHST(new Date(Date.UTC(2026, 5, 1, 5, 0)));
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 4);   // May
    assert.equal(d.getDate(), 31);
  });
});

// ── RAISES schedule ──────────────────────────────────────────────────
// The RAISES dates must round-trip through getFullYear/getMonth/getDate
// in any local timezone (the table at #raises-table-body and the projector's
// `r.date > cutoff` comparisons both rely on local-component reads).
test('RAISES dates are TZ-stable', () => {
  const expected = [
    [2025, 6, 1],
    [2026, 6, 1],
    [2027, 6, 1],
    [2028, 6, 1],
  ];
  assert.equal(RAISES.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    const [y, m, d] = expected[i];
    assert.equal(RAISES[i].date.getFullYear(), y, `RAISES[${i}] year`);
    assert.equal(RAISES[i].date.getMonth(),    m, `RAISES[${i}] month`);
    assert.equal(RAISES[i].date.getDate(),     d, `RAISES[${i}] day`);
  }
});

test('buildPaystubStream', async (t) => {
  await t.test('empty input returns []', () => {
    assert.deepEqual(buildPaystubStream([]), []);
  });

  await t.test('Jan–Jun, 2 stubs/mo @ $2000 each → 6 entries, regular=$4000, total=$4000', () => {
    const stubs = [];
    for (let m = 0; m < 6; m++) {
      stubs.push(stub(2024, m,  1, 15, { Regular: 2000 }));
      stubs.push(stub(2024, m, 16, lastDayOfMonth(2024, m), { Regular: 2000 }));
    }
    const stream = buildPaystubStream(stubs);
    assert.equal(stream.length, 6);
    for (let i = 0; i < 6; i++) {
      assert.equal(stream[i].month.getFullYear(), 2024);
      assert.equal(stream[i].month.getMonth(), i);
      assert.equal(stream[i].month.getDate(), 1);
      assert.equal(stream[i].regular, 4000);
      assert.equal(stream[i].total,   4000);
    }
  });

  await t.test('1-month gap (Jan + Mar) → 3 entries with Feb zero-filled', () => {
    const stubs = [
      stub(2024, 0, 1, 31, { Regular: 3000 }),
      stub(2024, 2, 1, 31, { Regular: 3500 }),
    ];
    assert.deepEqual(summarize(buildPaystubStream(stubs)), [
      { y: 2024, m: 0, regular: 3000, total: 3000 },
      { y: 2024, m: 1, regular: 0,    total: 0    },
      { y: 2024, m: 2, regular: 3500, total: 3500 },
    ]);
  });

  await t.test('overtime/differential → regular ≤ total invariant', () => {
    const stubs = [
      stub(2024, 0,  1, 15, { Regular: 2000, 'Ordinary Overtime': 500 }),
      stub(2024, 0, 16, 31, { Regular: 2000, 'Night Shift Differential': 200 }),
    ];
    const stream = buildPaystubStream(stubs);
    assert.equal(stream.length, 1);
    assert.equal(stream[0].regular, 4000);
    assert.equal(stream[0].total,   4700);
    assert.ok(stream[0].regular <= stream[0].total);
  });

  await t.test('cross-year span (Nov 2023 → Feb 2024) → 4 entries, gaps zero-filled', () => {
    const stubs = [
      stub(2023, 10, 1, 30, { Regular: 2000 }),
      stub(2024,  1, 1, 29, { Regular: 2500 }),  // Feb 2024 leap, day 29 = month-end
    ];
    assert.deepEqual(summarize(buildPaystubStream(stubs)), [
      { y: 2023, m: 10, regular: 2000, total: 2000 },
      { y: 2023, m: 11, regular: 0,    total: 0    },
      { y: 2024, m:  0, regular: 0,    total: 0    },
      { y: 2024, m:  1, regular: 2500, total: 2500 },
    ]);
  });

  await t.test('trailing mid-month stub triggers truncation; stream ends at last fully-covered month', () => {
    // Five complete months (Jan–May), then a trailing half-month stub for June.
    const stubs = [];
    for (let m = 0; m < 5; m++) {
      stubs.push(stub(2024, m,  1, 15, { Regular: 2000 }));
      stubs.push(stub(2024, m, 16, lastDayOfMonth(2024, m), { Regular: 2000 }));
    }
    stubs.push(stub(2024, 5, 1, 15, { Regular: 2000 }));  // June 1–15 only
    const stream = buildPaystubStream(stubs);
    assert.equal(stream.length, 5);
    assert.equal(stream[stream.length - 1].month.getMonth(), 4);  // May
    for (const e of stream) {
      assert.equal(e.regular, 4000);
      assert.equal(e.total,   4000);
    }
  });

  await t.test('no month-end stub anywhere → returns []', () => {
    const stubs = [
      stub(2024, 0, 1, 15, { Regular: 2000 }),
      stub(2024, 1, 1, 15, { Regular: 2000 }),
    ];
    assert.deepEqual(buildPaystubStream(stubs), []);
  });
});

// ── buildSyntheticStream ─────────────────────────────────────────────
test('buildSyntheticStream', async (t) => {
  await t.test('default monthsBack=60, anchor at month-start → 60 ascending months ending at anchor', () => {
    const anchor = new Date(2026, 4, 1);  // 2026-05-01
    const stream = buildSyntheticStream(5000, anchor);
    assert.equal(stream.length, 60);
    assert.equal(stream[stream.length - 1].month.getTime(), anchor.getTime());
    assert.equal(stream[0].month.getFullYear(), 2021);
    assert.equal(stream[0].month.getMonth(), 5);  // June 2021
    for (let i = 1; i < stream.length; i++) {
      assert.ok(stream[i].month > stream[i - 1].month);
    }
    for (const e of stream) {
      assert.equal(e.regular, 5000);
      assert.equal(e.total, 5000);
    }
  });

  await t.test('mid-month anchor snaps to first-of-month', () => {
    const stream = buildSyntheticStream(4000, new Date(2026, 4, 17), 12);
    assert.equal(stream.length, 12);
    assert.equal(stream[stream.length - 1].month.getDate(), 1);
    assert.equal(stream[stream.length - 1].month.getMonth(), 4);
    assert.equal(stream[stream.length - 1].month.getFullYear(), 2026);
  });

  await t.test('custom monthsBack honored', () => {
    const stream = buildSyntheticStream(3000, new Date(2026, 0, 1), 24);
    assert.equal(stream.length, 24);
    assert.equal(stream[0].month.getFullYear(), 2024);
    assert.equal(stream[0].month.getMonth(), 1);  // Feb 2024
  });
});

// ── projectAfcAtRetirement ───────────────────────────────────────────
const flatStream = (startY, startM, count, regular, total) => {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ month: new Date(startY, startM + i, 1), regular, total });
  }
  return out;
};

test('projectAfcAtRetirement', async (t) => {
  await t.test('1. flat stream, no raises → returns flat value exactly', () => {
    const afc = projectAfcAtRetirement({
      stream: flatStream(2021, 0, 60, 5000, 5000),  // Jan 2021 – Dec 2025
      retDate:      new Date(2026, 0, 1),
      raises: [],
      N: 3,
      mode: 'regular',
      lastDayOfSvc: null,
    });
    assert.equal(afc, 5000);
  });

  await t.test('2. flat stream + saturated single raise → base × (1+r) exactly', () => {
    // Raise date must be > stream end (Dec 2025) — past raises are filtered
    // out as already-baked-into-base; this fixture exercises the future-raise
    // path where saturation is meaningful.
    const afc = projectAfcAtRetirement({
      stream: flatStream(2016, 0, 120, 5000, 5000),  // Jan 2016 – Dec 2025
      retDate:      new Date(2029, 11, 1),           // 48 future months at 5250
      raises: [{ date: new Date(2026, 0, 1), rate: 0.05 }],
      N: 3,
      mode: 'regular',
      lastDayOfSvc: null,
    });
    assert.equal(afc, 5250);
  });

  await t.test('3. NR-dominated past, near-term retDate → past total wins', () => {
    const afc = projectAfcAtRetirement({
      stream: flatStream(2021, 0, 60, 5000, 6000),
      retDate:      new Date(2026, 1, 1),
      raises: [{ date: new Date(2026, 0, 1), rate: 0.05 }],
      N: 3,
      mode: 'total',
      lastDayOfSvc: null,
    });
    assert.equal(afc, 6000);
  });

  await t.test('4. NR-dominated past, far-term retDate → past total still wins', () => {
    const afc = projectAfcAtRetirement({
      stream: flatStream(2021, 0, 60, 5000, 6000),
      retDate:      new Date(2029, 0, 1),            // 37 future months at 5250
      raises: [{ date: new Date(2026, 0, 1), rate: 0.05 }],
      N: 3,
      mode: 'total',
      lastDayOfSvc: null,
    });
    assert.equal(afc, 6000);
  });

  await t.test('5. raises compounded > NR markup → future beats past', () => {
    // Four 5% raises compound to 1.05^4 ≈ 1.2155, exceeding the 6000/5000 = 1.20 markup.
    const afc = projectAfcAtRetirement({
      stream: flatStream(2021, 0, 60, 5000, 6000),
      retDate:      new Date(2032, 11, 1),           // 48 months at maximally-raised
      raises: [
        { date: new Date(2026, 0, 1), rate: 0.05 },
        { date: new Date(2027, 0, 1), rate: 0.05 },
        { date: new Date(2028, 0, 1), rate: 0.05 },
        { date: new Date(2029, 0, 1), rate: 0.05 },
      ],
      N: 3,
      mode: 'total',
      lastDayOfSvc: null,
    });
    const expected = 5000 * Math.pow(1.05, 4);
    assert.ok(Math.abs(afc - expected) < 0.01,
      `afc=${afc} expected=${expected}`);
  });

  await t.test('6. equivalence with applyRaises on saturated module RAISES', () => {
    // Stream must end before the earliest RAISES entry so that ALL of them
    // are "future" relative to streamEnd — otherwise the projector's past-
    // raise filter would skip some entries while applyRaises (no filter)
    // applies all, breaking equivalence.
    const base = 5000;
    const retDate = new Date(2032, 0, 1);            // ≥ last raise (2028-07-01) + N×12
    const stream = flatStream(2014, 0, 120, base, base);  // Jan 2014 – Dec 2023
    const projected = projectAfcAtRetirement({
      stream,
      retDate,
      raises: RAISES,
      N: 3,
      mode: 'regular',
      lastDayOfSvc: null,
    });
    const reference = applyRaises(base, retDate, 3, null);
    assert.ok(Math.abs(projected - reference) < 0.01,
      `projected=${projected} reference=${reference}`);
  });

  await t.test('7. insufficient windows → null', () => {
    // 11 past + 1 future = 12 months → exactly 1 window; need 3 for N=3.
    const afc = projectAfcAtRetirement({
      stream: flatStream(2025, 1, 11, 5000, 5000),   // Feb–Dec 2025
      retDate:      new Date(2026, 0, 1),
      raises: [],
      N: 3,
      mode: 'regular',
      lastDayOfSvc: null,
    });
    assert.equal(afc, null);
  });

  await t.test('8. empty stream → null', () => {
    const afc = projectAfcAtRetirement({
      stream: [],
      retDate: new Date(2030, 0, 1),
      raises: RAISES, N: 5, mode: 'regular', lastDayOfSvc: null,
    });
    assert.equal(afc, null);
  });

  await t.test('9. past raise during coverage → not double-applied', () => {
    // Real paystubs from after a raise already reflect that raise in their
    // values, so `base` (last paystub's regular pay) has it baked in.
    // Multiplying by the raise again for future months would double-count.
    // Stream: 6 months pre-raise at 5000, 18 months post-raise at 5250.
    const stream = [];
    for (let i = 0; i < 6;  i++) stream.push({ month: new Date(2024, i,     1), regular: 5000, total: 5000 });
    for (let i = 0; i < 18; i++) stream.push({ month: new Date(2024, 6 + i, 1), regular: 5250, total: 5250 });
    const afc = projectAfcAtRetirement({
      stream,
      retDate:      new Date(2027, 11, 1),
      raises: [{ date: new Date(2024, 6, 1), rate: 0.05 }],
      N: 1,
      mode: 'regular',
      lastDayOfSvc: null,
    });
    // Expected 5250 (no future raises after stream end). Pre-fix returned
    // 5250 * 1.05 = 5512.50.
    assert.equal(afc, 5250);
  });
});

// ── calculateSeries (Stage 4 wiring) ──────────────────────────────────
const nextMonthStart = () => {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth() + 1, 1);
};

const flatPastStream = (currentMonth, n, regular, total) => {
  const out = [];
  const y = currentMonth.getFullYear();
  const m = currentMonth.getMonth() - n;
  for (let i = 0; i < n; i++) {
    out.push({ month: new Date(y, m + i, 1), regular, total });
  }
  return out;
};

const baseInputs = (overrides = {}) => ({
  plan: 'hybrid-post2012',
  dob: new Date(1960, 0, 1),
  enteredSvcMonths: 180,
  ncSvcMonths: 0,
  asOfDate: new Date(2024, 0, 1),
  lastDayOfSvc: null,
  afcMonthly: 5000,
  slHours: null,
  slRate: 14,
  slAsOf: null,
  paystubStream: null,
  ...overrides,
});

test('calculateSeries: paystubStream wiring', async (t) => {
  await t.test('1. manual AFC on total-mode plan → all raise-related fields are null', () => {
    // Regular-mode plans now extrapolate manual AFC through a synthetic
    // stream (covered by separate test below); only total-mode plans
    // suppress raises entirely without paystubs.
    const series = calculateSeries(baseInputs({ plan: 'noncontributory' }));
    for (const row of series) {
      assert.equal(row.pensionWithRaises, null);
      assert.equal(row.pensionRaisesCurrentSL, null);
      assert.equal(row.pensionRaisesProjectedSL, null);
    }
  });

  await t.test('2. saturated regular-only paystub → matches legacy applyRaises', () => {
    const start = nextMonthStart();
    const stream = flatPastStream(start, 60, 5000, 5000);
    const series = calculateSeries(baseInputs({
      paystubStream: stream,
    }));
    // hybrid-post2012 has N=5; last RAISE 2028-07-01 → saturation at retDate ≥ 2033-07-01.
    const row = series.find(r => r.retDate >= new Date(2033, 6, 1) && r.pensionWithRaises != null);
    assert.ok(row, 'expected at least one saturated row with pensionWithRaises set');
    // Reconstruct what the legacy applyRaises path would have produced.
    // Pass streamEnd so applyRaises filters past raises consistently with
    // the projector — otherwise the equivalence breaks when RAISES contains
    // entries that fall within the stream's coverage.
    const plan = 'hybrid-post2012';
    const config = PLAN_CONFIGS[plan];
    const dob = new Date(1960, 0, 1);
    const svcAtM = serviceAtMonth(180, new Date(2024, 0, 1), row.retDate, null);
    const eligAge = primaryEligAge(dob, row.retDate);
    const arfAge  = primaryArfAge(dob, row.retDate);
    const offElig = primaryEligibility(plan, eligAge, Math.floor(svcAtM / 12));
    const arf     = primaryARF(offElig, plan, arfAge.year, arfAge.month);
    const streamEnd = stream[stream.length - 1].month;
    const legacyRaisedAfc = applyRaises(5000, row.retDate, config.N, null, streamEnd);
    const expected = blendedBenefit(svcAtM, 0, legacyRaisedAfc, arf, plan, config);
    assert.equal(row.pensionWithRaises, expected);
  });

  await t.test('3. NR-present noncontributory → projector stays at past total; raises pin to primaryPension', () => {
    const start = nextMonthStart();
    const stream = flatPastStream(start, 60, 5000, 6000);
    const series = calculateSeries(baseInputs({
      plan: 'noncontributory',
      afcMonthly: 6000,        // what solveDP would give for this stream + mode='total'
      paystubStream: stream,
    }));
    // Compounded RAISES (1.0379 × 1.04 × 1.04 ≈ 1.1226) never exceed the NR
    // markup (6000/5000 = 1.20), so projector AFC stays at 6000 = afcMonthly,
    // raisesActive is false. With paystubStream present, pensionWithRaises
    // pins to primaryPension on every eligible row (so the chart curve has
    // no left-edge gap); ineligible rows stay null.
    for (const row of series) {
      if (row.primaryPension == null) {
        assert.equal(row.pensionWithRaises, null);
      } else {
        assert.equal(row.pensionWithRaises, row.primaryPension);
      }
    }
    // Sanity check: legacy applyRaises would have grown afcMonthly above 6000
    // at a saturated retDate — confirming the divergence the projector fixes.
    const sample = series.find(r => r.retDate >= new Date(2031, 6, 1));
    if (sample) {
      const legacy = applyRaises(6000, sample.retDate, 3, null);
      assert.ok(legacy > 6000, `legacy applyRaises ${legacy} should exceed 6000`);
    }
  });

  await t.test('4. lastDayOfSvc before first RAISE → raise curves pin to primaryPension everywhere', () => {
    const start = nextMonthStart();
    const stream = flatPastStream(start, 60, 5000, 5000);
    const series = calculateSeries(baseInputs({
      paystubStream: stream,
      // 2026-06-30, before the first FUTURE raise (2026-07-01). The 2025-07-01
      // entry in RAISES is past relative to the stream and gets filtered.
      lastDayOfSvc: new Date(2026, 5, 30),
    }));
    // No raise is ever in horizon, so raisesActive is false on every row.
    // With paystubStream present, pensionWithRaises pins to primaryPension.
    for (const row of series) {
      if (row.primaryPension == null) {
        assert.equal(row.pensionWithRaises, null);
      } else {
        assert.equal(row.pensionWithRaises, row.primaryPension);
      }
    }
  });

  await t.test('5. regular-mode plan + manual AFC, no paystubs → raises extrapolate via synthetic stream', () => {
    // Time-dependent: assertions track which RAISES entries are still future
    // relative to today's first-of-month (the synthetic stream's anchor).
    const now = new Date();
    const anchorMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const futureRaises = RAISES.filter(r => r.date > anchorMonth);
    if (!futureRaises.length) return;  // RAISES exhausted; nothing to assert.

    const series = calculateSeries(baseInputs());  // hybrid-post2012, manual AFC=5000

    // Saturated retDate: ≥ N years past the last future raise so all top-N
    // windows fall entirely after the final raise.
    const lastFuture = futureRaises[futureRaises.length - 1];
    const satDate = new Date(lastFuture.date.getFullYear() + 6, lastFuture.date.getMonth(), 1);
    const sat = series.find(r => r.retDate >= satDate && r.pensionWithRaises != null);
    assert.ok(sat, 'expected at least one saturated row with pensionWithRaises set');

    // Compare pensionWithRaises against the closed-form saturated value.
    const plan = 'hybrid-post2012';
    const config = PLAN_CONFIGS[plan];
    const dob = new Date(1960, 0, 1);
    const svcAtM = serviceAtMonth(180, new Date(2024, 0, 1), sat.retDate, null);
    const eligAge = primaryEligAge(dob, sat.retDate);
    const arfAge  = primaryArfAge(dob, sat.retDate);
    const offElig = primaryEligibility(plan, eligAge, Math.floor(svcAtM / 12));
    const arf     = primaryARF(offElig, plan, arfAge.year, arfAge.month);
    const expectedRaisedAfc = 5000 * futureRaises.reduce((a, r) => a * (1 + r.rate), 1);
    const expected = blendedBenefit(svcAtM, 0, expectedRaisedAfc, arf, plan, config);
    // Tolerance absorbs floor-rounding inside blendedBenefit at saturation.
    assert.ok(Math.abs(sat.pensionWithRaises - expected) <= 1,
      `pensionWithRaises=${sat.pensionWithRaises} expected≈${expected}`);
    assert.ok(sat.pensionWithRaises > sat.primaryPension,
      `raises should lift AFC at saturation (${sat.pensionWithRaises} vs ${sat.primaryPension})`);
  });

  await t.test('6. regular-mode + manual AFC + lastDayOfSvc cuts off all RAISES → raises pin to primary', () => {
    const now = new Date();
    const anchorMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstFuture = RAISES.find(r => r.date > anchorMonth);
    if (!firstFuture) return;  // No future raises to cut off.
    // Pick lastDayOfSvc one day before the first future raise so the synthetic
    // stream's projector caps before any raise can land.
    const lastDayOfSvc = new Date(firstFuture.date.getTime() - 86400000);

    const series = calculateSeries(baseInputs({ lastDayOfSvc }));
    for (const row of series) {
      if (row.primaryPension == null) {
        assert.equal(row.pensionWithRaises, null);
      } else {
        assert.equal(row.pensionWithRaises, row.primaryPension);
      }
    }
  });

  await t.test('7. total-mode plan + manual AFC, no paystubs → no raise extrapolation', () => {
    // Stronger version of test 1: actually look at a retDate where regular-
    // mode would have lifted, and confirm total-mode still produces null.
    const series = calculateSeries(baseInputs({ plan: 'noncontributory' }));
    const farFuture = series.find(r => r.retDate >= new Date(2035, 0, 1) && r.primaryPension != null);
    assert.ok(farFuture, 'expected an eligible far-future row');
    assert.equal(farFuture.pensionWithRaises, null);
  });
});
