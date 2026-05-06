// Tests for lib/pension.js — run with `node --test tests/` from repo root.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPaystubStream,
  projectAfcAtRetirement,
  applyRaises,
  RAISES,
} = require('../lib/pension.js');

const stub = (y, m, d1, d2, earnings) => ({
  beginDate: new Date(y, m, d1),
  endDate:   new Date(y, m, d2),
  currentEarnings: earnings,
});

const summarize = (stream) =>
  stream.map(e => ({
    y: e.month.getFullYear(),
    m: e.month.getMonth(),
    regular: e.regular,
    total: e.total,
  }));

test('buildPaystubStream', async (t) => {
  await t.test('empty input returns []', () => {
    assert.deepEqual(buildPaystubStream([]), []);
  });

  await t.test('Jan–Jun, 2 stubs/mo @ $2000 each → 6 entries, regular=$4000, total=$4000', () => {
    const stubs = [];
    for (let m = 0; m < 6; m++) {
      stubs.push(stub(2024, m,  1, 15, { Regular: 2000 }));
      stubs.push(stub(2024, m, 16, 28, { Regular: 2000 }));
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
      stub(2024,  1, 1, 28, { Regular: 2500 }),
    ];
    assert.deepEqual(summarize(buildPaystubStream(stubs)), [
      { y: 2023, m: 10, regular: 2000, total: 2000 },
      { y: 2023, m: 11, regular: 0,    total: 0    },
      { y: 2024, m:  0, regular: 0,    total: 0    },
      { y: 2024, m:  1, regular: 2500, total: 2500 },
    ]);
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
      currentMonth: new Date(2026, 0, 1),
      retDate:      new Date(2026, 0, 1),
      raises: [],
      N: 3,
      mode: 'regular',
      lastDayOfSvc: null,
    });
    assert.equal(afc, 5000);
  });

  await t.test('2. flat stream + saturated single raise → base × (1+r) exactly', () => {
    const afc = projectAfcAtRetirement({
      stream: flatStream(2016, 0, 120, 5000, 5000),  // Jan 2016 – Dec 2025
      currentMonth: new Date(2026, 0, 1),
      retDate:      new Date(2029, 11, 1),           // 48 future months at 5250
      raises: [{ date: new Date(2018, 0, 1), rate: 0.05 }],
      N: 3,
      mode: 'regular',
      lastDayOfSvc: null,
    });
    assert.equal(afc, 5250);
  });

  await t.test('3. NR-dominated past, near-term retDate → past total wins', () => {
    const afc = projectAfcAtRetirement({
      stream: flatStream(2021, 0, 60, 5000, 6000),
      currentMonth: new Date(2026, 0, 1),
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
      currentMonth: new Date(2026, 0, 1),
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
      currentMonth: new Date(2026, 0, 1),
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
    const base = 5000;
    const retDate = new Date(2032, 0, 1);            // ≥ last raise (2028-07-01) + N×12
    const stream = flatStream(2016, 0, 120, base, base);
    const projected = projectAfcAtRetirement({
      stream,
      currentMonth: new Date(2026, 0, 1),
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
      currentMonth: new Date(2026, 0, 1),
      retDate:      new Date(2026, 0, 1),
      raises: [],
      N: 3,
      mode: 'regular',
      lastDayOfSvc: null,
    });
    assert.equal(afc, null);
  });
});
