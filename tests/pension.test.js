// Tests for lib/pension.js — run with `node --test tests/` from repo root.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPaystubStream,
  buildSyntheticStream,
  projectAfcAtRetirement,
  solveDP,
  vacationPayoutAt,
  buildVacationSeries,
  applyRaises,
  blendedBenefit,
  calculateSeries,
  derivePlanKey,
  sickLeaveToMonths,
  serviceAtMonth,
  primaryEligAge,
  primaryArfAge,
  primaryEligibility,
  primaryARF,
  addMonths,
  monthsBetween,
  PLAN_CONFIGS,
  RAISES,
  VACATION_CAP_HOURS,
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

// ── derivePlanKey ───────────────────────────────────────────────────
// Mediates dropdown value + memDate → internal PLAN_CONFIGS key. Tier
// (post2012 vs pre2012) is derived from memDate against the 2012-07-01
// boundary; noncontributory has no tier and ignores memDate.
test('derivePlanKey', async (t) => {
  await t.test('hybrid + post-2012 memDate → hybrid-post2012', () => {
    assert.equal(derivePlanKey('hybrid', '2014-08-01'), 'hybrid-post2012');
  });
  await t.test('hybrid + pre-2012 memDate → hybrid-pre2012', () => {
    assert.equal(derivePlanKey('hybrid', '2010-01-01'), 'hybrid-pre2012');
  });
  await t.test('contributory + post-2012 memDate → contributory-post2012', () => {
    assert.equal(derivePlanKey('contributory', '2020-01-01'), 'contributory-post2012');
  });
  await t.test('contributory + pre-2012 memDate → contributory-pre2012', () => {
    assert.equal(derivePlanKey('contributory', '2005-06-15'), 'contributory-pre2012');
  });
  await t.test('noncontributory → noncontributory regardless of memDate', () => {
    assert.equal(derivePlanKey('noncontributory', '2014-08-01'), 'noncontributory');
    assert.equal(derivePlanKey('noncontributory', '2005-06-15'), 'noncontributory');
    assert.equal(derivePlanKey('noncontributory', ''),           'noncontributory');
  });
  await t.test('boundary 2012-07-01 is inclusive → post2012', () => {
    assert.equal(derivePlanKey('hybrid',       '2012-07-01'), 'hybrid-post2012');
    assert.equal(derivePlanKey('contributory', '2012-07-01'), 'contributory-post2012');
  });
  await t.test('day before boundary (2012-06-30) → pre2012', () => {
    assert.equal(derivePlanKey('hybrid',       '2012-06-30'), 'hybrid-pre2012');
    assert.equal(derivePlanKey('contributory', '2012-06-30'), 'contributory-pre2012');
  });
  await t.test('hybrid or contributory with empty memDate → ""', () => {
    assert.equal(derivePlanKey('hybrid',       ''), '');
    assert.equal(derivePlanKey('contributory', ''), '');
  });
  await t.test('unknown plan string → ""', () => {
    assert.equal(derivePlanKey('',         '2014-08-01'), '');
    assert.equal(derivePlanKey('bogus',    '2014-08-01'), '');
    assert.equal(derivePlanKey(undefined,  '2014-08-01'), '');
  });
});

// ── sickLeaveToMonths ───────────────────────────────────────────────
// ERS rule: ≥ 60 days (480 hrs) required; 60d → 3mo, each further 20d
// → +1mo, remainder ≥ 10d → +1mo. Combined, this produces a 10-day
// step pattern after the 60-day threshold (the "remainder bump" alternates
// with the "whole step" so months tick at days = 60, 70, 80, 90, …).
test('sickLeaveToMonths', async (t) => {
  await t.test('0 hours → 0', () => {
    assert.equal(sickLeaveToMonths(0), 0);
  });
  await t.test('under 60-day threshold (472 hrs / 59 days) → 0', () => {
    assert.equal(sickLeaveToMonths(472), 0);
  });
  await t.test('exactly 60 days (480 hrs) → 3', () => {
    assert.equal(sickLeaveToMonths(480), 3);
  });
  await t.test('69 days (552 hrs) → 3 (remainder 9 < 10, no bump)', () => {
    assert.equal(sickLeaveToMonths(552), 3);
  });
  await t.test('70 days (560 hrs) → 4 (remainder 10 bumps)', () => {
    assert.equal(sickLeaveToMonths(560), 4);
  });
  await t.test('79 days (632 hrs) → 4 (remainder 19 still bumps; no double-count at 80)', () => {
    assert.equal(sickLeaveToMonths(632), 4);
  });
  await t.test('80 days (640 hrs) → 4 (whole step, remainder reset to 0)', () => {
    assert.equal(sickLeaveToMonths(640), 4);
  });
  await t.test('89 days (712 hrs) → 4 (remainder 9 < 10, no bump)', () => {
    assert.equal(sickLeaveToMonths(712), 4);
  });
  await t.test('90 days (720 hrs) → 5 (remainder 10 bumps again)', () => {
    assert.equal(sickLeaveToMonths(720), 5);
  });
});

// ── blendedBenefit ──────────────────────────────────────────────────
// Pension formula in isolation, separated from `calculateSeries` wiring.
// Hybrid plans split service: NC portion at 1.25%, remainder at the plan's
// multiplier. Non-hybrid plans use the uniform formula and ignore ncMonths.
// Final cents are floored to whole dollars.
test('blendedBenefit', async (t) => {
  await t.test('non-hybrid uniform formula: 25 yos × $5000 AFC × 0.0125 multiplier', () => {
    const cfg = PLAN_CONFIGS.noncontributory;
    // 5000 × 25 × 0.0125 × 1.0 = 1562.5 → floor to whole dollars = 1562
    assert.equal(blendedBenefit(300, 0, 5000, 1.0, 'noncontributory', cfg), 1562);
  });

  await t.test('hybrid with ncMonths=0 → uniform formula at hybrid multiplier', () => {
    const cfg = PLAN_CONFIGS['hybrid-post2012'];
    // 6000 × 20 × 0.0175 × 1.0 = 2100, exact
    assert.equal(blendedBenefit(240, 0, 6000, 1.0, 'hybrid-post2012', cfg), 2100);
  });

  await t.test('hybrid with ncMonths == svcMonths → all 1.25% NC portion', () => {
    const cfg = PLAN_CONFIGS['hybrid-post2012'];
    // hybridYrs collapses to 0; 5000 × 10 × 0.0125 × 1.0 = 625
    assert.equal(blendedBenefit(120, 120, 5000, 1.0, 'hybrid-post2012', cfg), 625);
  });

  await t.test('hybrid mixed: 48mo NC at 1.25% + 132mo hybrid at 2.00%', () => {
    const cfg = PLAN_CONFIGS['hybrid-pre2012'];
    // 4000 × (11×0.02 + 4×0.0125) × 1.0 = 4000 × 0.27 = 1080
    assert.equal(blendedBenefit(180, 48, 4000, 1.0, 'hybrid-pre2012', cfg), 1080);
  });

  await t.test('cents-floor: fractional benefit truncates to whole dollars', () => {
    const cfg = PLAN_CONFIGS.noncontributory;
    // 5000 × (305/12) × 0.0125 × 1.0 = 1588.5416…, floors to 1588
    assert.equal(blendedBenefit(305, 0, 5000, 1.0, 'noncontributory', cfg), 1588);
  });

  await t.test('ARF < 1 applied multiplicatively (early-retirement penalty)', () => {
    const cfg = PLAN_CONFIGS.noncontributory;
    // 5000 × 25 × 0.0125 × 0.8 = 1250
    assert.equal(blendedBenefit(300, 0, 5000, 0.8, 'noncontributory', cfg), 1250);
  });

  await t.test('ARF = 0 (ineligible) → benefit 0 regardless of svc/AFC', () => {
    const cfg = PLAN_CONFIGS['hybrid-post2012'];
    assert.equal(blendedBenefit(240, 60, 5000, 0, 'hybrid-post2012', cfg), 0);
  });

  await t.test('ncMonths ignored on non-hybrid plans (same result as ncMonths=0)', () => {
    const cfg = PLAN_CONFIGS.noncontributory;
    // ncMonths=240 would collapse hybridYrs to 5 if it weren't ignored;
    // result matches the uniform-formula case above (1562) instead.
    assert.equal(blendedBenefit(300, 240, 5000, 1.0, 'noncontributory', cfg), 1562);
  });
});

// ── primaryEligibility ──────────────────────────────────────────────
// 5 plans × 3 outcomes decision table, with dual-threshold and exact-birthday
// edges. `eligAge` is constructed inline as { year, month, day } literals to
// isolate this function from primaryEligAge.
test('primaryEligibility', async (t) => {
  const age = (year, month = 0, day = 0) => ({ year, month, day });

  // ── 5 plans × 3 outcomes (one representative case per cell) ─────
  await t.test('noncontributory: age 55 / svc 30 → regular (alt path)', () => {
    assert.equal(primaryEligibility('noncontributory', age(55), 30), 'regular');
  });
  await t.test('noncontributory: age 55 / svc 20 → early', () => {
    assert.equal(primaryEligibility('noncontributory', age(55), 20), 'early');
  });
  await t.test('noncontributory: age 54 / svc 20 → ineligible (under 55)', () => {
    assert.equal(primaryEligibility('noncontributory', age(54), 20), 'ineligible');
  });

  await t.test('hybrid-pre2012: age 62 / svc 5 → regular (first path)', () => {
    assert.equal(primaryEligibility('hybrid-pre2012', age(62), 5), 'regular');
  });
  await t.test('hybrid-pre2012: age 55 / svc 20 → early', () => {
    assert.equal(primaryEligibility('hybrid-pre2012', age(55), 20), 'early');
  });
  await t.test('hybrid-pre2012: age 54 / svc 30 → ineligible (under 55)', () => {
    assert.equal(primaryEligibility('hybrid-pre2012', age(54), 30), 'ineligible');
  });

  await t.test('hybrid-post2012: age 65 / svc 10 → regular (first path)', () => {
    assert.equal(primaryEligibility('hybrid-post2012', age(65), 10), 'regular');
  });
  await t.test('hybrid-post2012: age 55 / svc 20 → early', () => {
    assert.equal(primaryEligibility('hybrid-post2012', age(55), 20), 'early');
  });
  await t.test('hybrid-post2012: age 54 / svc 30 → ineligible (under 55)', () => {
    assert.equal(primaryEligibility('hybrid-post2012', age(54), 30), 'ineligible');
  });

  await t.test('contributory-pre2012: age 55 / svc 5 → regular', () => {
    assert.equal(primaryEligibility('contributory-pre2012', age(55), 5), 'regular');
  });
  await t.test('contributory-pre2012: age 30 / svc 25 → early (any age, svc ≥ 25)', () => {
    assert.equal(primaryEligibility('contributory-pre2012', age(30), 25), 'early');
  });
  await t.test('contributory-pre2012: age 54 / svc 24 → ineligible', () => {
    assert.equal(primaryEligibility('contributory-pre2012', age(54), 24), 'ineligible');
  });

  await t.test('contributory-post2012: age 60 / svc 10 → regular', () => {
    assert.equal(primaryEligibility('contributory-post2012', age(60), 10), 'regular');
  });
  await t.test('contributory-post2012: age 55 / svc 25 → early', () => {
    assert.equal(primaryEligibility('contributory-post2012', age(55), 25), 'early');
  });
  await t.test('contributory-post2012: age 59 / svc 24 → ineligible', () => {
    assert.equal(primaryEligibility('contributory-post2012', age(59), 24), 'ineligible');
  });

  // ── Dual-threshold edges ────────────────────────────────────────
  await t.test('hybrid-pre2012: age 55 / svc 30 → regular (second path)', () => {
    assert.equal(primaryEligibility('hybrid-pre2012', age(55), 30), 'regular');
  });
  await t.test('hybrid-pre2012: age 55 / svc 25 → early (svc ≥ 20 but no regular path)', () => {
    assert.equal(primaryEligibility('hybrid-pre2012', age(55), 25), 'early');
  });

  // ── noncontributory: pbd > 0 exact-birthday edge at age 62 ──────
  await t.test('noncontributory: age 62 exactly (pbd=0) / svc 10 → ineligible', () => {
    // pbd = month*30 + day = 0, so the y>62 and (y===62 && pbd>0) branches
    // both fail; (y>=55 && svc>=30) also fails since svc<30 → ineligible.
    assert.equal(primaryEligibility('noncontributory', age(62, 0, 0), 10), 'ineligible');
  });
  await t.test('noncontributory: age 62 + 1 month (pbd > 0) / svc 10 → regular', () => {
    assert.equal(primaryEligibility('noncontributory', age(62, 1, 0), 10), 'regular');
  });

  // ── Default fallthrough ─────────────────────────────────────────
  await t.test('unknown plan key → ineligible', () => {
    assert.equal(primaryEligibility('bogus', age(70), 30), 'ineligible');
    assert.equal(primaryEligibility('',      age(70), 30), 'ineligible');
  });
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

// ── solveDP ─────────────────────────────────────────────────────────
// Official ERS top-N rule: pick the N non-overlapping 12-month windows
// with the highest summed score. Two windows are non-overlapping iff the
// earlier window's `endIncl` is strictly less than the later window's
// `start`. Backtrack returns selected in ascending-start order regardless
// of how the DP discovered them.
test('solveDP', async (t) => {
  // Build a 12-month window starting at index `start` with the given score.
  const w = (start, score) => ({ start, endIncl: start + 11, score });

  await t.test('empty windows array → null', () => {
    assert.equal(solveDP([], 1), null);
  });

  await t.test('single window N=1 → that window with total = score', () => {
    const r = solveDP([w(0, 100)], 1);
    assert.notEqual(r, null);
    assert.equal(r.total, 100);
    assert.deepEqual(r.selected, [w(0, 100)]);
  });

  await t.test('two non-overlapping windows N=2 → both selected, total = sum', () => {
    const w1 = w(0, 50);
    const w2 = w(12, 70);
    const r = solveDP([w1, w2], 2);
    assert.equal(r.total, 120);
    assert.deepEqual(r.selected, [w1, w2]);
  });

  await t.test('overlapping pair (endIncl=11 ≥ start=5) N=2 → null', () => {
    const r = solveDP([w(0, 50), w(5, 70)], 2);
    assert.equal(r, null);
  });

  await t.test('score-based selection: scores [10, 1, 9] N=2 → picks [10, 9] = 19, skips middle', () => {
    const w1 = w(0,  10);
    const w2 = w(12,  1);
    const w3 = w(24,  9);
    const r = solveDP([w1, w2, w3], 2);
    assert.equal(r.total, 19);
    assert.deepEqual(r.selected, [w1, w3]);
  });

  await t.test('three overlapping windows N=2 → null (no valid pair)', () => {
    // starts 0, 3, 6 with endIncl 11, 14, 17 — every pair overlaps.
    const r = solveDP([w(0, 10), w(3, 20), w(6, 30)], 2);
    assert.equal(r, null);
  });

  await t.test('backtrack returns selected in ascending start order, not selection order', () => {
    const w1 = w(0,  5);
    const w2 = w(12, 8);
    const w3 = w(24, 3);
    const r = solveDP([w1, w2, w3], 3);
    assert.equal(r.total, 16);
    assert.deepEqual(r.selected, [w1, w2, w3]);
    assert.deepEqual(r.selected.map(s => s.start), [0, 12, 24]);
  });
});

// ── snapWalkVacationHours ─────────────────────────────────────────────
const { snapWalkVacationHours } = require('../lib/pension.js');

test('snapWalkVacationHours', async (t) => {
  await t.test('1. identity: endDate == startDate → returns startHours', () => {
    const d = new Date(2025, 0, 1);
    const h = snapWalkVacationHours({
      startHours: 500, startDate: d, endDate: d, accrualHrsPerMo: 14,
    });
    assert.equal(h, 500);
  });

  await t.test('2. same-year walk under cap: Jan 1 → Dec 1, 720 + 11×14 → 874', () => {
    const h = snapWalkVacationHours({
      startHours: 720,
      startDate:  new Date(2025, 0, 1),
      endDate:    new Date(2025, 11, 1),
      accrualHrsPerMo: 14,
    });
    assert.equal(h, 874);
  });

  await t.test('3. single Jan 1 crossing hits cap: Jan 1 2025 → Jan 1 2026, 720 + 168 then snap → 720', () => {
    const h = snapWalkVacationHours({
      startHours: 720,
      startDate:  new Date(2025, 0, 1),
      endDate:    new Date(2026, 0, 1),
      accrualHrsPerMo: 14,
    });
    assert.equal(h, 720);
  });

  await t.test('4. single Jan 1 crossing under cap: 400 + 168 → 568, no snap', () => {
    const h = snapWalkVacationHours({
      startHours: 400,
      startDate:  new Date(2025, 0, 1),
      endDate:    new Date(2026, 0, 1),
      accrualHrsPerMo: 14,
    });
    assert.equal(h, 568);
  });

  await t.test('5. multi-year sawtooth: 30 months Jan 1 2025 → Jul 1 2027, 720 start → 804', () => {
    // y=2026: snap to 720. y=2027: snap to 720. Then 6 months × 14 = 84.
    const h = snapWalkVacationHours({
      startHours: 720,
      startDate:  new Date(2025, 0, 1),
      endDate:    new Date(2027, 6, 1),
      accrualHrsPerMo: 14,
    });
    assert.equal(h, 804);
  });

  await t.test('6. mid-year start crossing Jan 1: Jul 15 2025 → Jan 1 2026, 800 hrs, accrual=0 → snap to 720', () => {
    const h = snapWalkVacationHours({
      startHours: 800,
      startDate:  new Date(2025, 6, 15),
      endDate:    new Date(2026, 0, 1),
      accrualHrsPerMo: 0,
    });
    assert.equal(h, 720);
  });

  await t.test('7. endDate < startDate → returns startHours clamped ≥ 0', () => {
    const h = snapWalkVacationHours({
      startHours: 400,
      startDate:  new Date(2026, 0, 1),
      endDate:    new Date(2025, 0, 1),
      accrualHrsPerMo: 14,
    });
    assert.equal(h, 400);
    const hNeg = snapWalkVacationHours({
      startHours: -50,
      startDate:  new Date(2026, 0, 1),
      endDate:    new Date(2025, 0, 1),
      accrualHrsPerMo: 14,
    });
    assert.equal(hNeg, 0);
  });

  await t.test('8. excludeFinalSnap suppresses snap at endDate=Jan 1: 720 + 168 → 888', () => {
    const h = snapWalkVacationHours({
      startHours: 720,
      startDate:  new Date(2025, 0, 1),
      endDate:    new Date(2026, 0, 1),
      accrualHrsPerMo: 14,
      excludeFinalSnap: true,
    });
    assert.equal(h, 888);
  });

  await t.test('9. excludeFinalSnap only skips the FINAL boundary: earlier Jan 1 still snaps', () => {
    // 2-year walk: snap at Jan 1 2026 fires, then 12 more accruals to Jan 1 2027 (skipped) → 888.
    const h = snapWalkVacationHours({
      startHours: 720,
      startDate:  new Date(2025, 0, 1),
      endDate:    new Date(2027, 0, 1),
      accrualHrsPerMo: 14,
      excludeFinalSnap: true,
    });
    assert.equal(h, 888);
  });

  await t.test('10. excludeFinalSnap is a no-op when endDate isn\'t Jan 1', () => {
    // Dec 1 endDate, with vs without flag → identical (no boundary at endDate to skip).
    const args = {
      startHours: 720,
      startDate:  new Date(2025, 0, 1),
      endDate:    new Date(2025, 11, 1),
      accrualHrsPerMo: 14,
    };
    const a = snapWalkVacationHours(args);
    const b = snapWalkVacationHours({ ...args, excludeFinalSnap: true });
    assert.equal(a, b);
    assert.equal(a, 874);
  });
});

// ── vacationPayoutAt ──────────────────────────────────────────────────
test('vacationPayoutAt', async (t) => {
  await t.test('1. linear accrual sanity: 12 months at 14 hrs/mo from 0 → 168 hrs', () => {
    const r = vacationPayoutAt(new Date(2026, 0, 1), {
      vacHoursAsOf: 0,
      vacAsOfDate:  new Date(2025, 0, 1),
      accrualHrsPerMo: 14,
      hourlyRateAtAsOf: 1,
      raises: [],
    });
    assert.equal(r.currentPayout, 0);
    assert.equal(r.maxPayout, 168);
    assert.equal(r.projectedHourlyRate, 1);
  });

  await t.test('2. no Jan 1 cross within window → no snap', () => {
    // vacAsOf Jan 1, retDate Feb 1: same year, no Jan 1 boundary crossed.
    // Hours stay above 720 on both curves; only accrual differs.
    const r = vacationPayoutAt(new Date(2025, 1, 1), {
      vacHoursAsOf: 800,
      vacAsOfDate:  new Date(2025, 0, 1),
      accrualHrsPerMo: 14,
      hourlyRateAtAsOf: 10,
      raises: [],
    });
    assert.equal(r.currentPayout, 800 * 10);
    assert.equal(r.maxPayout,    814 * 10);  // 800 + 14×1 month
  });

  await t.test('3. multi-year sawtooth on max curve, current under cap stays flat', () => {
    // vacAsOf Jan 1 2025 → retDate Jan 1 2030. Max-curve trajectory:
    //   y=2026: 400 + 168 = 568 (no snap, under 720)
    //   y=2027: 568 + 168 = 736 → snap to 720
    //   y=2028: 720 + 168 = 888 → snap to 720
    //   y=2029: 720 + 168 = 888 → snap to 720
    //   y=2030: 720 + 168 = 888 → snap to 720
    // Current curve: 400 stays at 400 across all snaps (under cap).
    const r = vacationPayoutAt(new Date(2030, 0, 1), {
      vacHoursAsOf: 400,
      vacAsOfDate:  new Date(2025, 0, 1),
      accrualHrsPerMo: 14,
      hourlyRateAtAsOf: 1,
      raises: [],
    });
    assert.equal(r.currentPayout, 400);
    assert.equal(r.maxPayout, 720);
  });

  await t.test('4. hourly rate compounds across multiple future raises', () => {
    const r = vacationPayoutAt(new Date(2030, 0, 1), {
      vacHoursAsOf: 100,
      vacAsOfDate:  new Date(2025, 0, 1),
      accrualHrsPerMo: 0,
      hourlyRateAtAsOf: 45,
      raises: [
        { date: new Date(2025, 6, 1), rate: 0.035  },
        { date: new Date(2026, 6, 1), rate: 0.0379 },
        { date: new Date(2027, 6, 1), rate: 0.04   },
        { date: new Date(2028, 6, 1), rate: 0.04   },
      ],
    });
    const expected = 45 * 1.035 * 1.0379 * 1.04 * 1.04;
    assert.ok(Math.abs(r.projectedHourlyRate - expected) < 1e-9,
      `projectedHourlyRate=${r.projectedHourlyRate} expected=${expected}`);
    assert.ok(Math.abs(r.currentPayout - 100 * expected) < 1e-9);
  });

  await t.test('5. past raises (date ≤ vacAsOfDate) filtered out', () => {
    // First raise is at the as-of date — strict `>` excludes it. Second
    // raise is after, so it applies.
    const r = vacationPayoutAt(new Date(2027, 0, 1), {
      vacHoursAsOf: 100,
      vacAsOfDate:  new Date(2025, 6, 1),
      accrualHrsPerMo: 0,
      hourlyRateAtAsOf: 45,
      raises: [
        { date: new Date(2025, 6, 1), rate: 0.035  },  // == asOf → skipped
        { date: new Date(2024, 6, 1), rate: 0.10   },  // < asOf  → skipped
        { date: new Date(2026, 6, 1), rate: 0.0379 },  // > asOf  → applies
      ],
    });
    const expected = 45 * 1.0379;
    assert.ok(Math.abs(r.projectedHourlyRate - expected) < 1e-9,
      `projectedHourlyRate=${r.projectedHourlyRate} expected=${expected}`);
  });

  await t.test('6. raise after retDate not applied', () => {
    const r = vacationPayoutAt(new Date(2026, 0, 1), {
      vacHoursAsOf: 100,
      vacAsOfDate:  new Date(2025, 0, 1),
      accrualHrsPerMo: 0,
      hourlyRateAtAsOf: 45,
      raises: [
        { date: new Date(2025, 6, 1), rate: 0.035  },  // applies
        { date: new Date(2026, 6, 1), rate: 0.0379 },  // > retDate → skipped
      ],
    });
    const expected = 45 * 1.035;
    assert.ok(Math.abs(r.projectedHourlyRate - expected) < 1e-9);
  });

  await t.test('7. retDate before asOf → no negative accrual; max == current', () => {
    const r = vacationPayoutAt(new Date(2025, 6, 1), {
      vacHoursAsOf: 400,
      vacAsOfDate:  new Date(2026, 0, 1),
      accrualHrsPerMo: 14,
      hourlyRateAtAsOf: 45,
      raises: [],
    });
    assert.equal(r.currentPayout, 400 * 45);
    assert.equal(r.maxPayout,    400 * 45);  // accrual clamped to 0
  });

  await t.test('8. zero hourly rate → all payouts zero', () => {
    const r = vacationPayoutAt(new Date(2030, 0, 1), {
      vacHoursAsOf: 400,
      vacAsOfDate:  new Date(2025, 0, 1),
      accrualHrsPerMo: 14,
      hourlyRateAtAsOf: 0,
      raises: [{ date: new Date(2026, 0, 1), rate: 0.05 }],
    });
    assert.equal(r.currentPayout, 0);
    assert.equal(r.maxPayout, 0);
    assert.equal(r.projectedHourlyRate, 0);
  });

  await t.test('9. zero starting hours but non-zero accrual → max grows from current=0', () => {
    const r = vacationPayoutAt(new Date(2026, 0, 1), {
      vacHoursAsOf: 0,
      vacAsOfDate:  new Date(2025, 0, 1),
      accrualHrsPerMo: 14,
      hourlyRateAtAsOf: 50,
      raises: [],
    });
    assert.equal(r.currentPayout, 0);
    assert.equal(r.maxPayout, 168 * 50);
  });

  await t.test('10. cutoff caps both accrual and raises at min(cutoff, retDate)', () => {
    // retDate is 5 years out; cutoff is 1 year out. Accrual runs for 12 mo,
    // and only the 2025-07-01 raise applies (the 2026-07-01 raise is past cutoff).
    const r = vacationPayoutAt(new Date(2030, 0, 1), {
      vacHoursAsOf: 0,
      vacAsOfDate:  new Date(2025, 0, 1),
      accrualHrsPerMo: 14,
      hourlyRateAtAsOf: 45,
      raises: [
        { date: new Date(2025, 6, 1), rate: 0.035  },
        { date: new Date(2026, 6, 1), rate: 0.0379 },
      ],
      cutoff: new Date(2026, 0, 1),
    });
    const expectedRate = 45 * 1.035;
    assert.ok(Math.abs(r.projectedHourlyRate - expectedRate) < 1e-9,
      `projectedHourlyRate=${r.projectedHourlyRate} expected=${expectedRate}`);
    assert.equal(r.maxPayout, 168 * expectedRate);
  });

  await t.test('11. in-year peak: 720 start, retDate Dec 1 same year → maxPayout = 874', () => {
    const r = vacationPayoutAt(new Date(2025, 11, 1), {
      vacHoursAsOf: 720,
      vacAsOfDate:  new Date(2025, 0, 1),
      accrualHrsPerMo: 14,
      hourlyRateAtAsOf: 1,
      raises: [],
    });
    assert.equal(r.maxPayout, 874);
    assert.equal(r.currentPayout, 720);
  });

  await t.test('12. Jan 1 snap consumes the year of accrual: 720 start → maxPayout = 720 at Jan 1 next year', () => {
    const r = vacationPayoutAt(new Date(2026, 0, 1), {
      vacHoursAsOf: 720,
      vacAsOfDate:  new Date(2025, 0, 1),
      accrualHrsPerMo: 14,
      hourlyRateAtAsOf: 1,
      raises: [],
    });
    assert.equal(r.maxPayout, 720);
    assert.equal(r.currentPayout, 720);
  });

  await t.test('13. current curve snaps too: 800 start, retDate Feb 1 next year → currentPayout = 720', () => {
    const r = vacationPayoutAt(new Date(2026, 1, 1), {
      vacHoursAsOf: 800,
      vacAsOfDate:  new Date(2025, 0, 1),
      accrualHrsPerMo: 0,
      hourlyRateAtAsOf: 1,
      raises: [],
    });
    assert.equal(r.currentPayout, 720);
    assert.equal(r.maxPayout, 720);
  });

  await t.test('14. excludeFinalSnap exposes pre-snap peak at Jan 1 retDate', () => {
    // 800 start, retDate Jan 1 2026, accrual 14, flag on → 968 hrs (12 accruals, snap suppressed).
    const r = vacationPayoutAt(new Date(2026, 0, 1), {
      vacHoursAsOf: 800,
      vacAsOfDate:  new Date(2025, 0, 1),
      accrualHrsPerMo: 14,
      hourlyRateAtAsOf: 1,
      raises: [],
      excludeFinalSnap: true,
    });
    assert.equal(r.maxPayout, 968);
    assert.equal(r.currentPayout, 800);  // current curve: 800 held flat, snap at endDate suppressed
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

  await t.test('8. calculateSeries no longer carries vacation fields', () => {
    // Vacation moved to buildVacationSeries; pension rows shouldn't surface
    // those keys at all.
    const series = calculateSeries(baseInputs());
    assert.ok(series.length > 0);
    assert.equal('vacationCurrentPayout' in series[0], false);
    assert.equal('vacationMaxPayout' in series[0], false);
  });

  await t.test('9. slHours=480 (3mo) + slRate=0 → pensionCurrentSL bumps svc by 3; projectedSL == currentSL', () => {
    const series = calculateSeries(baseInputs({
      slHours: 480,             // = 60 days = exactly 3 months SL credit
      slRate:  0,               // no further accrual; currentMo == projectedMo
      slAsOf:  new Date(2024, 0, 1),
    }));

    // First normal-retirement row out a few years (member is 65+ from start).
    const row = series.find(r => r.retDate >= new Date(2030, 0, 1) && r.primaryPension != null);
    assert.ok(row, 'expected at least one eligible row');

    const plan   = 'hybrid-post2012';
    const config = PLAN_CONFIGS[plan];
    const dob    = new Date(1960, 0, 1);
    const svcAtM  = serviceAtMonth(180, new Date(2024, 0, 1), row.retDate, null);
    const eligAge = primaryEligAge(dob, row.retDate);
    const arfAge  = primaryArfAge(dob, row.retDate);
    const offElig = primaryEligibility(plan, eligAge, Math.floor(svcAtM / 12));
    const arf     = primaryARF(offElig, plan, arfAge.year, arfAge.month);

    const expected = blendedBenefit(svcAtM + 3, 0, 5000, arf, plan, config);
    assert.equal(row.pensionCurrentSL,   expected);
    assert.equal(row.pensionProjectedSL, expected);  // slRate=0 → no further accrual

    // The raise+SL columns are populated because hybrid-post2012 is regular-
    // mode and manual AFC triggers the synthetic stream → hasEffectiveStream.
    assert.notEqual(row.pensionRaisesCurrentSL,   null);
    assert.notEqual(row.pensionRaisesProjectedSL, null);
  });

  await t.test('10. slHours=null → all four SL columns null on every row (regression guard)', () => {
    const series = calculateSeries(baseInputs());  // slHours: null by default
    for (const row of series) {
      assert.equal(row.pensionCurrentSL,         null);
      assert.equal(row.pensionProjectedSL,       null);
      assert.equal(row.pensionRaisesCurrentSL,   null);
      assert.equal(row.pensionRaisesProjectedSL, null);
    }
  });

  await t.test('11. SL credits to hybrid portion: ncSvcMonths is preserved across the SL bump', () => {
    // Mixed-service hybrid: 48mo NC at 1.25% + 132mo hybrid at 0.0175 = 180 total.
    // SL bumps svcAtM by 3mo; ncSvcMonths stays 48, so the bump credits to the
    // hybrid portion (hybridYrs = (svcAtM+3-48)/12, ncYrs unchanged).
    const series = calculateSeries(baseInputs({
      ncSvcMonths: 48,
      slHours:     480,
      slRate:      0,
      slAsOf:      new Date(2024, 0, 1),
    }));

    const row = series.find(r => r.retDate >= new Date(2030, 0, 1) && r.primaryPension != null);
    assert.ok(row, 'expected at least one eligible row');

    const plan   = 'hybrid-post2012';
    const config = PLAN_CONFIGS[plan];
    const dob    = new Date(1960, 0, 1);
    const svcAtM  = serviceAtMonth(180, new Date(2024, 0, 1), row.retDate, null);
    const eligAge = primaryEligAge(dob, row.retDate);
    const arfAge  = primaryArfAge(dob, row.retDate);
    const offElig = primaryEligibility(plan, eligAge, Math.floor(svcAtM / 12));
    const arf     = primaryARF(offElig, plan, arfAge.year, arfAge.month);

    // ncSvcMonths preserved at 48 in the SL-bumped call.
    const expected = blendedBenefit(svcAtM + 3, 48, 5000, arf, plan, config);
    assert.equal(row.pensionCurrentSL, expected);

    // Sanity: primaryPension reconstructs without the SL bump.
    const primaryRecon = blendedBenefit(svcAtM, 48, 5000, arf, plan, config);
    assert.equal(row.primaryPension, primaryRecon);

    // SL bump strictly raises the benefit (3 extra months at hybridMult > 0).
    assert.ok(row.pensionCurrentSL > row.primaryPension,
      `SL bump should lift benefit (${row.pensionCurrentSL} vs ${row.primaryPension})`);
  });
});

// ── buildVacationSeries ──────────────────────────────────────────────
test('buildVacationSeries', async (t) => {
  const today = todayInHST();
  const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  await t.test('1. active member, no LDOS → today → today+48mo, monthly rows + Dec 31 peaks', () => {
    const result = buildVacationSeries({
      vacHours: 400,
      vacAsOf:  new Date(2025, 0, 1),
      vacRate:  14,
      vacHourlyRate: 45,
      lastDayOfSvc: null,
    });
    assert.equal(result.separated, false);
    assert.ok(result.rows.length > 0);
    assert.equal(result.rows[0].retDate.getTime(), startMonth.getTime());
    const expectedEnd = addMonths(startMonth, 48);
    assert.equal(result.rows[result.rows.length - 1].retDate.getTime(), expectedEnd.getTime());

    // Month-1 rows are one month apart.
    const monthlyRows = result.rows.filter(r => r.retDate.getDate() === 1);
    for (let i = 1; i < monthlyRows.length; i++) {
      const gap = monthsBetween(monthlyRows[i - 1].retDate, monthlyRows[i].retDate);
      assert.equal(gap, 1, `monthly row ${i} is not one month after row ${i - 1}`);
    }

    // One Dec 31 peak row per year-end inside [startMonth, expectedEnd].
    const peakRows = result.rows.filter(r => r.retDate.getDate() === 31 && r.retDate.getMonth() === 11);
    const expectedPeakYears = [];
    for (let y = startMonth.getFullYear(); y <= expectedEnd.getFullYear(); y++) {
      const ye = new Date(y, 11, 31);
      if (ye >= startMonth && ye <= expectedEnd) expectedPeakYears.push(y);
    }
    assert.equal(peakRows.length, expectedPeakYears.length);
    for (let i = 0; i < peakRows.length; i++) {
      assert.equal(peakRows[i].retDate.getFullYear(), expectedPeakYears[i]);
    }

    // Rows are sorted by retDate.
    for (let i = 1; i < result.rows.length; i++) {
      assert.ok(result.rows[i].retDate >= result.rows[i - 1].retDate, `row ${i} out of order`);
    }
  });

  await t.test('2. future LDOS within 4y → horizon still extends to today+48mo', () => {
    const ldos = addMonths(startMonth, 24);  // 2 years out
    const result = buildVacationSeries({
      vacHours: 400,
      vacAsOf:  new Date(2025, 0, 1),
      vacHourlyRate: 45,
      lastDayOfSvc: ldos,
    });
    assert.equal(result.separated, false);
    const lastRow = result.rows[result.rows.length - 1];
    const expectedEnd = addMonths(startMonth, 48);
    assert.equal(lastRow.retDate.getTime(), expectedEnd.getTime(),
      'LDOS within 4y should not shorten the horizon below today+4y');
    assert.equal(result.lastDayOfSvc.getTime(), ldos.getTime());
  });

  await t.test('3. future LDOS beyond 4y → horizon stops exactly at LDOS month', () => {
    const ldos = addMonths(startMonth, 72);  // 6 years out
    const ldosMid = new Date(ldos.getFullYear(), ldos.getMonth(), 15);
    const result = buildVacationSeries({
      vacHours: 0,
      vacAsOf:  new Date(2025, 0, 1),
      vacHourlyRate: 45,
      lastDayOfSvc: ldosMid,
    });
    assert.equal(result.separated, false);
    const lastRow = result.rows[result.rows.length - 1];
    const expectedEnd = new Date(ldos.getFullYear(), ldos.getMonth(), 1);
    assert.equal(lastRow.retDate.getTime(), expectedEnd.getTime(),
      'LDOS > 4y out should cap horizon at LDOS month');
  });

  await t.test('4. already separated → short-circuit summary, no rows', () => {
    const ldos = new Date(2024, 5, 15);  // past
    const result = buildVacationSeries({
      vacHours: 600,
      vacAsOf:  new Date(2024, 0, 1),
      vacRate:  14,
      vacHourlyRate: 45,
      lastDayOfSvc: ldos,
    });
    assert.equal(result.separated, true);
    assert.equal(result.separatedOn.getTime(), ldos.getTime());
    assert.equal('rows' in result, false);
    // 600 + 14*5 = 670 (under cap); rate untouched (no raises in window)
    assert.equal(result.finalHours, 670);
    assert.ok(result.finalPayout > 0);
    assert.ok(result.finalRate > 0);
  });

  await t.test('5. no Jan 1 cross → finalHours retains accrual above 720', () => {
    // vacAsOf Jan 1 2024 → LDOS Jul 1 2024: same calendar year, no snap.
    // 800 + 14×6 = 884.
    const result = buildVacationSeries({
      vacHours: 800,
      vacAsOf:  new Date(2024, 0, 1),
      vacRate:  14,
      vacHourlyRate: 50,
      lastDayOfSvc: new Date(2024, 6, 1),
    });
    assert.equal(result.separated, true);
    assert.equal(result.finalHours, 884);
    assert.equal(result.finalPayout, 884 * result.finalRate);
  });

  await t.test('6. with-raise pair lifts above no-raise pair; raisesNA preserved on result but does not affect row math', () => {
    // Pick LDOS far enough out that at least one RAISES entry would land
    // within the projection horizon. Skip if no future raises remain (test
    // stability across calendar drift).
    const futureRaises = RAISES.filter(r => r.date > today);
    if (!futureRaises.length) return;
    const lastRaise = futureRaises[futureRaises.length - 1];
    const horizonEnd = new Date(lastRaise.date.getFullYear() + 1, lastRaise.date.getMonth(), 1);

    const args = {
      vacHours: 0,
      vacAsOf:  new Date(today.getFullYear() - 1, today.getMonth(), 1),
      vacHourlyRate: 45,
      lastDayOfSvc: horizonEnd,
    };
    const onResult  = buildVacationSeries({ ...args, raisesNA: false });
    const offResult = buildVacationSeries({ ...args, raisesNA: true });

    // raisesNA echoed on the result so the chart can suppress raise curves
    // without losing the values it needs for axis sizing.
    assert.equal(onResult.raisesNA,  false);
    assert.equal(offResult.raisesNA, true);

    // With-raise pair lifts above no-raise pair regardless of `raisesNA`.
    for (const result of [onResult, offResult]) {
      const last = result.rows[result.rows.length - 1];
      assert.ok(last.maxPayoutWithRaises > last.maxPayout,
        `raises should lift maxPayoutWithRaises above maxPayout (raisesNA=${result.raisesNA})`);
    }

    // Row payouts match exactly between the two — raisesNA does not affect
    // the math, only the flag carried on the result.
    for (let i = 0; i < onResult.rows.length; i++) {
      assert.deepEqual(
        {
          c:  onResult.rows[i].currentPayout,
          m:  onResult.rows[i].maxPayout,
          cR: onResult.rows[i].currentPayoutWithRaises,
          mR: onResult.rows[i].maxPayoutWithRaises,
        },
        {
          c:  offResult.rows[i].currentPayout,
          m:  offResult.rows[i].maxPayout,
          cR: offResult.rows[i].currentPayoutWithRaises,
          mR: offResult.rows[i].maxPayoutWithRaises,
        },
      );
    }
  });

  await t.test('7. vacHours = 0 produces a valid (flat-current, ramping-max) series', () => {
    const result = buildVacationSeries({
      vacHours: 0,
      vacAsOf:  new Date(today.getFullYear() - 1, today.getMonth(), 1),
      vacRate:  14,
      vacHourlyRate: 45,
      lastDayOfSvc: null,
    });
    assert.equal(result.separated, false);
    assert.ok(result.rows.length > 0);
    for (const row of result.rows) assert.equal(row.currentPayout, 0);
    assert.ok(result.rows[result.rows.length - 1].maxPayout > result.rows[0].maxPayout);
  });

  await t.test('9. Dec 31 peak row exceeds adjacent Dec 1 by exactly one extra month of accrual', () => {
    // raisesNA: true keeps the hourly rate flat at 50 so the diff is
    // exactly accrualHrsPerMo × hourlyRate = 14 × 50 = 700.
    const result = buildVacationSeries({
      vacHours: 800,
      vacAsOf:  new Date(today.getFullYear() - 1, 0, 1),
      vacRate:  14,
      vacHourlyRate: 50,
      lastDayOfSvc: null,
      raisesNA: true,
    });
    const peak = result.rows.find(r => r.retDate.getDate() === 31 && r.retDate.getMonth() === 11);
    assert.ok(peak, 'Dec 31 peak row should be present');
    const dec1 = result.rows.find(r =>
      r.retDate.getDate() === 1 &&
      r.retDate.getMonth() === 11 &&
      r.retDate.getFullYear() === peak.retDate.getFullYear());
    assert.ok(dec1, 'matching Dec 1 row should be present');
    assert.equal(peak.maxPayout - dec1.maxPayout, 14 * 50);
  });

  await t.test('10. future LDOS in Mar of next year → no peak rows past LDOS', () => {
    const ldos = new Date(today.getFullYear() + 1, 2, 1);  // Mar 1 next year
    const result = buildVacationSeries({
      vacHours: 800,
      vacAsOf:  new Date(today.getFullYear() - 1, 0, 1),
      vacRate:  14,
      vacHourlyRate: 50,
      lastDayOfSvc: ldos,
    });
    const peakRows = result.rows.filter(r => r.retDate.getDate() === 31 && r.retDate.getMonth() === 11);
    for (const r of peakRows) {
      assert.ok(r.retDate <= ldos, `Dec 31 row ${r.retDate} should not be past LDOS ${ldos}`);
    }
    // At least one peak row from a year-end strictly before LDOS exists
    // (today's Dec 31 is in [startMonth, ldos] for any today before Mar 2 of next year).
    assert.ok(peakRows.length >= 1, 'expected at least one Dec 31 peak row before LDOS');
  });

  await t.test('8. already separated, LDOS crosses Jan 1 → finalHours snaps then re-accrues', () => {
    // vacAsOf Jan 1 2024 → LDOS Mar 1 2025: walk crosses Jan 1 2025.
    // y=2025: 800 + 14×12 = 968 → snap to 720.
    // trailing: 14 × 2 months = 28 → finalHours = 748.
    const result = buildVacationSeries({
      vacHours: 800,
      vacAsOf:  new Date(2024, 0, 1),
      vacRate:  14,
      vacHourlyRate: 50,
      lastDayOfSvc: new Date(2025, 2, 1),
    });
    assert.equal(result.separated, true);
    assert.equal(result.finalHours, 748);
    assert.equal(result.finalPayout, 748 * result.finalRate);
  });
});
