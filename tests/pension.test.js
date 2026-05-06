// Tests for lib/pension.js — run with `node --test tests/` from repo root.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPaystubStream } = require('../lib/pension.js');

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
