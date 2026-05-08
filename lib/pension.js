// Pure pension-calculation logic, extracted from index.html so it can be
// unit-tested under Node and reused without booting the page. Loaded from
// the browser as a classic script alongside lib/d3-*.min.js and lib/pdfjs-*.
// Top-level declarations become globals visible to the inline module
// script. The CommonJS exports footer makes the same file directly
// require()-able from Node.

// ── Plan definitions ─────────────────────────────────────────────
const PLAN_CONFIGS = {
  'hybrid-post2012':       { multiplier: 0.0175, N: 5, mode: 'regular', vestingMonths: 120, colaRate: 0.015 },
  'hybrid-pre2012':        { multiplier: 0.0200, N: 3, mode: 'total',   vestingMonths:  60, colaRate: 0.025 },
  'contributory-post2012': { multiplier: 0.0175, N: 5, mode: 'regular', vestingMonths: 120, colaRate: 0.015 },
  'contributory-pre2012':  { multiplier: 0.0200, N: 3, mode: 'total',   vestingMonths:  60, colaRate: 0.025 },
  'noncontributory':       { multiplier: 0.0125, N: 3, mode: 'total',   vestingMonths: 120, colaRate: 0.025 },
};

const TIER_BOUNDARY = new Date(2012, 6, 1);  // July 1, 2012
const PRE_1971_DATE = new Date(1971, 0, 1);

// Translates the (plan, memDate) pair from the form into the internal
// PLAN_CONFIGS key. Plan dropdown values are 'hybrid', 'contributory',
// or 'noncontributory'; memDate is the ERS membership date as a
// YYYY-MM-DD string. Tier (post-2012 vs pre-2012) is inferred from
// memDate against the 2012-07-01 boundary. Noncontributory has no
// tier and ignores memDate.
function derivePlanKey(plan, memDate) {
  if (plan === 'noncontributory') return 'noncontributory';
  if (plan !== 'hybrid' && plan !== 'contributory') return '';
  if (!memDate) return '';
  const tier = parseIsoDate(memDate) >= TIER_BOUNDARY ? 'post2012' : 'pre2012';
  return `${plan}-${tier}`;
}

// ── Projected raises (union contract, not yet absorbed into AFC) ──
const RAISES = [
  { date: new Date(2025, 6, 1), rate: 0.035  },
  { date: new Date(2026, 6, 1), rate: 0.0379 },
  { date: new Date(2027, 6, 1), rate: 0.04   },
  { date: new Date(2028, 6, 1), rate: 0.04   },
];

// ── Earnings-category constants ──────────────────────────────────
// The exact paystub category key for lump-sum vacation hasn't been seen
// in real stub data; this is the best-guess name. The PDF parser's
// KNOWN set (in index.html) also includes it so it doesn't trigger
// "unknown earning type" warnings if it ever appears; it is NOT in
// IGNORED because the pre-1971 dual-method's Method B needs to include it.
const LUMP_SUM_VACATION = 'Lump Sum Vacation Pay';

// Maximum unused vacation hours that convert to a lump-sum payout at
// retirement (90 days × 8 hrs/day). Also the carry-over cap between
// calendar years; the calculator applies it everywhere for projection
// purposes (current hours and running accrual both clamped to it).
const VACATION_CAP_HOURS = 720;

const IGNORED = new Set([
  'Temporary Hazard Pay',
  'Taxable WIK',
  'Tax WIK',
  'BNS Retro',
  'Bonus RetroPay Dues Eligible',
]);

// ── ARF tables ───────────────────────────────────────────────────
// Copied verbatim from ers.data.js (tier1) and ers.dataNew.js (tier2).
// Each table is keyed by [ageYear][monthIndex 0–11].
// A missing key falls back to ARF = 1 (normal retirement, no penalty).
const PRIMARY_ARF_TABLES = {
  tier1: {
    // Hybrid pre-2012: early retirement ages 55–61; normal at 62.
    tableH: {
      55: [0.650056,0.654222,0.658388,0.662554,0.66672,0.670886,0.675052,0.679218,0.683384,0.68755,0.691716,0.695882],
      56: [0.700048,0.704214,0.70838,0.712546,0.716712,0.720878,0.725044,0.72921,0.733376,0.737542,0.741708,0.745874],
      57: [0.75004,0.754206,0.758372,0.762538,0.766704,0.77087,0.775036,0.779202,0.783368,0.787534,0.7917,0.795866],
      58: [0.800032,0.804198,0.808364,0.81253,0.816696,0.820862,0.825028,0.829194,0.83336,0.837526,0.841692,0.845858],
      59: [0.850024,0.85419,0.858356,0.862522,0.866688,0.870854,0.87502,0.879186,0.883352,0.887518,0.891684,0.89585],
      60: [0.900016,0.904182,0.908348,0.912514,0.91668,0.920846,0.925012,0.929178,0.933344,0.93751,0.941676,0.945842],
      61: [0.950008,0.954174,0.95834,0.962506,0.966672,0.970838,0.975004,0.97917,0.983336,0.987502,0.991668,0.995834],
      62: [1],
    },
    // Noncontributory: early retirement ages 55–61; normal at 62.
    tableNonCon: {
      55: [0.580,0.585,0.590,0.595,0.600,0.605,0.610,0.615,0.620,0.625,0.630,0.635],
      56: [0.640,0.645,0.650,0.655,0.660,0.665,0.670,0.675,0.680,0.685,0.690,0.695],
      57: [0.700,0.705,0.710,0.715,0.720,0.725,0.730,0.735,0.740,0.745,0.750,0.755],
      58: [0.760,0.765,0.770,0.775,0.780,0.785,0.790,0.795,0.800,0.805,0.810,0.815],
      59: [0.820,0.825,0.830,0.835,0.840,0.845,0.850,0.855,0.860,0.865,0.870,0.875],
      60: [0.880,0.885,0.890,0.895,0.900,0.905,0.910,0.915,0.920,0.925,0.930,0.935],
      61: [0.940,0.945,0.950,0.955,0.960,0.965,0.970,0.975,0.980,0.985,0.990,0.995],
    },
    // Contributory pre-2012: early retirement ages 28–54; normal at 55.
    tableCon1: {
      28: [0.160096,0.161762,0.163428,0.165094,0.16676,0.168426,0.170092,0.171758,0.173424,0.17509,0.176756,0.178422],
      29: [0.180088,0.181754,0.18342,0.185086,0.186752,0.188418,0.190084,0.19175,0.193416,0.195082,0.196748,0.198414],
      30: [0.20008,0.201746,0.203412,0.205078,0.206744,0.20841,0.210076,0.211742,0.213408,0.215074,0.21674,0.218406],
      31: [0.220072,0.221738,0.223404,0.22507,0.226736,0.228402,0.230068,0.231734,0.2334,0.235066,0.236732,0.238398],
      32: [0.240064,0.24173,0.243396,0.245062,0.246728,0.248394,0.25006,0.251726,0.253392,0.255058,0.256724,0.25839],
      33: [0.260056,0.261722,0.263388,0.265054,0.26672,0.268386,0.270052,0.271718,0.273384,0.27505,0.276716,0.278382],
      34: [0.280048,0.281714,0.28338,0.285046,0.286712,0.288378,0.290044,0.29171,0.293376,0.295042,0.296708,0.298374],
      35: [0.30004,0.301706,0.303372,0.305038,0.306704,0.30837,0.310036,0.311702,0.313368,0.315034,0.3167,0.318366],
      36: [0.320032,0.321698,0.323364,0.32503,0.326696,0.328362,0.330028,0.331694,0.33336,0.335026,0.336692,0.338358],
      37: [0.340024,0.34169,0.343356,0.345022,0.346688,0.348354,0.35002,0.351686,0.353352,0.355018,0.356684,0.35835],
      38: [0.360016,0.361682,0.363348,0.365014,0.36668,0.368346,0.370012,0.371678,0.373344,0.37501,0.376676,0.378342],
      39: [0.380008,0.381674,0.38334,0.385006,0.386672,0.388338,0.390004,0.39167,0.393336,0.395002,0.396668,0.398334],
      40: [0.400000,0.402500,0.405000,0.407500,0.410000,0.412500,0.415000,0.417500,0.420000,0.422500,0.425000,0.427500],
      41: [0.430000,0.432500,0.435000,0.437500,0.440000,0.442500,0.445000,0.447500,0.450000,0.452500,0.455000,0.457500],
      42: [0.460000,0.462500,0.465000,0.467500,0.470000,0.472500,0.475000,0.477500,0.480000,0.482500,0.485000,0.487500],
      43: [0.490000,0.492500,0.495000,0.497500,0.500000,0.502500,0.505000,0.507500,0.510000,0.512500,0.515000,0.517500],
      44: [0.520000,0.522500,0.525000,0.527500,0.530000,0.532500,0.535000,0.537500,0.540000,0.542500,0.545000,0.547500],
      45: [0.550000,0.553333,0.556667,0.560000,0.563333,0.566667,0.570000,0.573333,0.576667,0.580000,0.583333,0.586667],
      46: [0.590000,0.593333,0.596667,0.600000,0.603333,0.606667,0.610000,0.613333,0.616667,0.620000,0.623333,0.626667],
      47: [0.630000,0.633333,0.636667,0.640000,0.643333,0.646667,0.650000,0.653333,0.656667,0.660000,0.663333,0.666667],
      48: [0.670000,0.673333,0.676667,0.680000,0.683333,0.686667,0.690000,0.693333,0.696667,0.700000,0.703333,0.706667],
      49: [0.710000,0.713333,0.716667,0.720000,0.723333,0.726667,0.730000,0.733333,0.736667,0.740000,0.743333,0.746667],
      50: [0.750000,0.754167,0.758333,0.762500,0.766667,0.770833,0.775000,0.779167,0.783333,0.787500,0.791667,0.795833],
      51: [0.800000,0.804167,0.808333,0.812500,0.816667,0.820833,0.825000,0.829167,0.833333,0.837500,0.841667,0.845833],
      52: [0.850000,0.854167,0.858333,0.862500,0.866667,0.870833,0.875000,0.879167,0.883333,0.887500,0.891667,0.895833],
      53: [0.900000,0.904167,0.908333,0.912500,0.916667,0.920833,0.925000,0.929167,0.933333,0.937500,0.941667,0.945833],
      54: [0.950000,0.954167,0.958333,0.962500,0.966667,0.970833,0.975000,0.979167,0.983333,0.987500,0.991667,0.995833],
    },
  },
  tier2: {
    // Hybrid post-2012: early retirement ages 55–64; normal at 65.
    tableH: {
      55: [0.50008,0.504246,0.508412,0.512578,0.516744,0.52091,0.525076,0.529242,0.533408,0.537574,0.54174,0.545906],
      56: [0.550072,0.554238,0.558404,0.56257,0.566736,0.570902,0.575068,0.579234,0.5834,0.587566,0.591732,0.595898],
      57: [0.600064,0.60423,0.608396,0.612562,0.616728,0.620894,0.62506,0.629226,0.633392,0.637558,0.641724,0.64589],
      58: [0.650056,0.654222,0.658388,0.662554,0.66672,0.670886,0.675052,0.679218,0.683384,0.68755,0.691716,0.695882],
      59: [0.700048,0.704214,0.70838,0.712546,0.716712,0.720878,0.725044,0.72921,0.733376,0.737542,0.741708,0.745874],
      60: [0.75004,0.754206,0.758372,0.762538,0.766704,0.77087,0.775036,0.779202,0.783368,0.787534,0.7917,0.795866],
      61: [0.800032,0.804198,0.808364,0.81253,0.816696,0.820862,0.825028,0.829194,0.83336,0.837526,0.841692,0.845858],
      62: [0.850024,0.85419,0.858356,0.862522,0.866688,0.870854,0.87502,0.879186,0.883352,0.887518,0.891684,0.89585],
      63: [0.900016,0.904182,0.908348,0.912514,0.91668,0.920846,0.925012,0.929178,0.933344,0.93751,0.941676,0.945842],
      64: [0.950008,0.954174,0.95834,0.962506,0.966672,0.970838,0.975004,0.97917,0.983336,0.987502,0.991668,0.995834],
    },
    // Contributory post-2012: early retirement ages 28–59; normal at 60.
    tableCon1: {
      28: [0.060196,0.061862,0.063528,0.065194,0.06686,0.068526,0.070192,0.071858,0.073524,0.07519,0.076856,0.078522],
      29: [0.080188,0.081854,0.08352,0.085186,0.086852,0.088518,0.090184,0.09185,0.093516,0.095182,0.096848,0.098514],
      30: [0.10018,0.101846,0.103512,0.105178,0.106844,0.10851,0.110176,0.111842,0.113508,0.115174,0.11684,0.118506],
      31: [0.120172,0.121838,0.123504,0.12517,0.126836,0.128502,0.130168,0.131834,0.1335,0.135166,0.136832,0.138498],
      32: [0.140164,0.14183,0.143496,0.145162,0.146828,0.148494,0.15016,0.151826,0.153492,0.155158,0.156824,0.15849],
      33: [0.160156,0.161822,0.163488,0.165154,0.16682,0.168486,0.170152,0.171818,0.173484,0.17515,0.176816,0.178482],
      34: [0.180148,0.181814,0.18348,0.185146,0.186812,0.188478,0.190144,0.19181,0.193476,0.195142,0.196808,0.198474],
      35: [0.20014,0.201806,0.203472,0.205138,0.206804,0.20847,0.210136,0.211802,0.213468,0.215134,0.2168,0.218466],
      36: [0.220132,0.221798,0.223464,0.22513,0.226796,0.228462,0.230128,0.231794,0.23346,0.235126,0.236792,0.238458],
      37: [0.240124,0.24179,0.243456,0.245122,0.246788,0.248454,0.25012,0.251786,0.253452,0.255118,0.256784,0.25845],
      38: [0.260116,0.261782,0.263448,0.265114,0.26678,0.268446,0.270112,0.271778,0.273444,0.27511,0.276776,0.278442],
      39: [0.280108,0.281774,0.28344,0.285106,0.286772,0.288438,0.290104,0.29177,0.293436,0.295102,0.296768,0.298434],
      40: [0.3001,0.301766,0.303432,0.305098,0.306764,0.30843,0.310096,0.311762,0.313428,0.315094,0.31676,0.318426],
      41: [0.320092,0.321758,0.323424,0.32509,0.326756,0.328422,0.330088,0.331754,0.33342,0.335086,0.336752,0.338418],
      42: [0.340084,0.34175,0.343416,0.345082,0.346748,0.348414,0.35008,0.351746,0.353412,0.355078,0.356744,0.35841],
      43: [0.360076,0.361742,0.363408,0.365074,0.36674,0.368406,0.370072,0.371738,0.373404,0.37507,0.376736,0.378402],
      44: [0.380068,0.381734,0.3834,0.385066,0.386732,0.388398,0.390064,0.39173,0.393396,0.395062,0.396728,0.398394],
      45: [0.40006,0.40256,0.40506,0.40756,0.41006,0.41256,0.41506,0.41756,0.42006,0.42256,0.42506,0.42756],
      46: [0.43006,0.43256,0.43506,0.43756,0.44006,0.44256,0.44506,0.44756,0.45006,0.45256,0.45506,0.45756],
      47: [0.46006,0.46256,0.46506,0.46756,0.47006,0.47256,0.47506,0.47756,0.48006,0.48256,0.48506,0.48756],
      48: [0.49006,0.49256,0.49506,0.49756,0.50006,0.50256,0.50506,0.50756,0.51006,0.51256,0.51506,0.51756],
      49: [0.52006,0.52256,0.52506,0.52756,0.53006,0.53256,0.53506,0.53756,0.54006,0.54256,0.54506,0.54756],
      50: [0.55006,0.553393,0.556726,0.560059,0.563392,0.566725,0.570058,0.573391,0.576724,0.580057,0.58339,0.586723],
      51: [0.590056,0.593389,0.596722,0.600055,0.603388,0.606721,0.610054,0.613387,0.61672,0.620053,0.623386,0.626719],
      52: [0.630052,0.633385,0.636718,0.640051,0.643384,0.646717,0.65005,0.653383,0.656716,0.660049,0.663382,0.666715],
      53: [0.670048,0.673381,0.676714,0.680047,0.68338,0.686713,0.690046,0.693379,0.696712,0.700045,0.703378,0.706711],
      54: [0.710044,0.713377,0.71671,0.720043,0.723376,0.726709,0.730042,0.733375,0.736708,0.740041,0.743374,0.746707],
      55: [0.75004,0.754206,0.758372,0.762538,0.766704,0.77087,0.775036,0.779202,0.783368,0.787534,0.7917,0.795866],
      56: [0.800032,0.804198,0.808364,0.81253,0.816696,0.820862,0.825028,0.829194,0.83336,0.837526,0.841692,0.845858],
      57: [0.850024,0.85419,0.858356,0.862522,0.866688,0.870854,0.87502,0.879186,0.883352,0.887518,0.891684,0.89585],
      58: [0.900016,0.904182,0.908348,0.912514,0.91668,0.920846,0.925012,0.929178,0.933344,0.93751,0.941676,0.945842],
      59: [0.950008,0.954174,0.95834,0.962506,0.966672,0.970838,0.975004,0.97917,0.983336,0.987502,0.991668,0.995834],
    },
  },
};

// Age calculation used by the source calculator for the ARF table lookup.
// Differs from fractionalAge(): days >= 15 rounds up to the next month.
// Returns { year, month } where month is 0-based (Jan = 0).
function primaryArfAge(dob, retDate) {
  let dayDiff   = retDate.getDate()     - dob.getDate();
  let monthDiff = retDate.getMonth()    - dob.getMonth();
  let yearDiff  = retDate.getFullYear() - dob.getFullYear();
  if (dayDiff < 0)   { monthDiff -= 1; dayDiff  += 30; }
  if (monthDiff < 0) { monthDiff += 12; yearDiff -= 1; }
  if (dayDiff >= 15) { monthDiff += 1; }
  if (monthDiff >= 12) { yearDiff += 1; monthDiff -= 12; }
  return { year: yearDiff, month: monthDiff };
}

// Age calculation used by the source calculator for eligibility checks.
// No day-rounding (unlike primaryArfAge) — just carries borrows across months/years.
// Returns { year, month, day } where day is the residual after borrow adjustment.
function primaryEligAge(dob, retDate) {
  let dayDiff   = retDate.getDate()     - dob.getDate();
  let monthDiff = retDate.getMonth()    - dob.getMonth();
  let yearDiff  = retDate.getFullYear() - dob.getFullYear();
  if (dayDiff < 0)   { monthDiff -= 1; dayDiff += 30; }
  if (monthDiff < 0) { monthDiff += 12; yearDiff -= 1; }
  return { year: yearDiff, month: monthDiff, day: dayDiff };
}

// Returns 'regular', 'early', or 'ineligible'.
// eligAge must be the result of primaryEligAge(dob, retDate).
// svcYears is total credited service in whole years (Math.floor(svcMonths / 12)).
function primaryEligibility(plan, eligAge, svcYears) {
  const y   = eligAge.year;
  const pbd = eligAge.month * 30 + eligAge.day; // days past birthday; >0 means past exact birthday
  switch (plan) {
    case 'noncontributory':
      if (((y > 62 || (y === 62 && pbd > 0)) && svcYears >= 10) || (y >= 55 && svcYears >= 30))
        return 'regular';
      if (y >= 55 && svcYears >= 20) return 'early';
      return 'ineligible';
    case 'hybrid-pre2012':
      if ((y >= 62 && svcYears >= 5) || (y >= 55 && svcYears >= 30)) return 'regular';
      if (y >= 55 && svcYears >= 20) return 'early';
      return 'ineligible';
    case 'hybrid-post2012':
      if ((y >= 65 && svcYears >= 10) || (y >= 60 && svcYears >= 30)) return 'regular';
      if (y >= 55 && svcYears >= 20) return 'early';
      return 'ineligible';
    case 'contributory-pre2012':
      if (y >= 55 && svcYears >= 5) return 'regular';
      if (svcYears >= 25) return 'early';
      return 'ineligible';
    case 'contributory-post2012':
      if (y >= 60 && svcYears >= 10) return 'regular';
      if (y >= 55 && svcYears >= 25) return 'early';
      return 'ineligible';
    default: return 'ineligible';
  }
}

// Returns the Age Reduction Factor from the primary lookup tables.
// arfYear/arfMonth must come from primaryArfAge().
function primaryARF(eligibility, plan, arfYear, arfMonth) {
  if (eligibility === 'regular')    return 1;
  if (eligibility === 'ineligible') return 0;
  const tier     = plan.endsWith('post2012') ? 'tier2' : 'tier1';
  const tableKey = plan.startsWith('hybrid')        ? 'tableH'
                 : plan === 'noncontributory'        ? 'tableNonCon'
                 :                                    'tableCon1';
  return PRIMARY_ARF_TABLES[tier]?.[tableKey]?.[arfYear]?.[arfMonth] ?? 1;
}

// Pre-1971 dual-method AFC trigger: members on hybrid-pre2012,
// contributory-pre2012, or noncontributory whose membership date is
// before 1971-01-01 are entitled to max(Method A, Method B).
// memDate is the parsed Date (or null/undefined when not yet entered).
function isPre1971DualMethod(planKey, memDate) {
  if (!memDate || memDate >= PRE_1971_DATE) return false;
  return planKey === 'hybrid-pre2012'
      || planKey === 'contributory-pre2012'
      || planKey === 'noncontributory';
}

// ── Date utilities ───────────────────────────────────────────────
// Calendar "today" in Pacific/Honolulu, returned as a local-midnight Date
// so it composes with the rest of the component-built date utilities.
// `now` is overridable for tests.
function todayInHST(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Pacific/Honolulu',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = t => +parts.find(p => p.type === t).value;
  return new Date(get('year'), get('month') - 1, get('day'));
}

// Reformat MM/dd/yyyy → yyyy/MM/dd for display.
function toYmd(s) { const [m, d, y] = s.split('/'); return `${y}/${m}/${d}`; }

// Parse MM/dd/yyyy → Date
function parseDate(s) {
  const [m, d, y] = s.split('/');
  return new Date(+y, +m - 1, +d);
}

function addMonths(date, n) {
  const d = new Date(date);
  const targetMonth = ((d.getMonth() + n) % 12 + 12) % 12;
  d.setMonth(d.getMonth() + n);
  // If the day overflowed into the wrong month, clamp to the last day of the intended month.
  if (d.getMonth() !== targetMonth) d.setDate(0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Format Date → MM/dd/yyyy
function fmtDate(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${m}/${d}/${date.getFullYear()}`;
}

// Whole calendar months from a to b (negative if b < a).
// Uses addMonths for boundary check so Jan 31 → Feb 28 = 1 month.
function monthsBetween(a, b) {
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (addMonths(a, m) > b) m--;
  return m;
}

// Age in fractional years (month-level precision).
function fractionalAge(dob, date) {
  return monthsBetween(dob, date) / 12;
}

// Credited service at a candidate retirement month.
// enteredMonths: service figure as of asOfDate (from ERS website or last day)
// asOfDate: reference date for the entered figure
// retDate: candidate retirement month (1st of month)
// lastDayOfSvc: optional — caps accrual; null = still active
function serviceAtMonth(enteredMonths, asOfDate, retDate, lastDayOfSvc) {
  const accrualEnd = lastDayOfSvc
    ? new Date(Math.min(lastDayOfSvc.getTime(), retDate.getTime()))
    : retDate;
  return enteredMonths + Math.max(0, monthsBetween(asOfDate, accrualEnd));
}

// Parse YYYY-MM-DD (from <input type="date">) as a local date.
function parseIsoDate(s) {
  const [y, m, d] = s.split('-');
  return new Date(+y, +m - 1, +d);
}

// Convert unused sick leave hours to credited service months per ERS rules.
// Requires ≥ 60 days (480 hrs); 60 days → 3 months, each further 20 days → 1 month,
// remainder ≥ 10 days → 1 extra month.
function sickLeaveToMonths(hours) {
  const days = hours / 8;
  if (days < 60) return 0;
  const whole     = Math.floor(days / 20);
  const remainder = days % 20;
  return whole + (remainder >= 10 ? 1 : 0);
}

// ── Pension math ─────────────────────────────────────────────────
// Returns afcMonthly grown by each scheduled raise, blended in linearly
// over the plan's N-year averaging window. Naturally underestimates for
// retirements within N years of a raise (covers the planning horizon).
// cutoff: optional last day of service — raises after cutoff don't apply,
// and the blend horizon is capped at cutoff (AFC stops growing at separation).
function applyRaises(afcMonthly, retDate, N, cutoff = null, streamEnd = null) {
  const cap = cutoff ? new Date(Math.min(cutoff.getTime(), retDate.getTime())) : retDate;
  let afc = afcMonthly;
  for (const { date, rate } of RAISES) {
    if (cap <= date) continue;
    // Mirror the projector: raises that occurred during the paystub
    // coverage are already baked into the AFC base and shouldn't compound.
    if (streamEnd && date <= streamEnd) continue;
    const blend = Math.min(1, monthsBetween(date, cap) / (N * 12));
    afc *= (1 + rate * blend);
  }
  return afc;
}

// Projects monthly AFC at a candidate retDate by concatenating the historical
// paystub stream (past) with a future projection (regular base × compounded
// raises), then picking the top-N non-overlapping 12-month windows by sum
// (the official ERS rule, matching solveDP). Returns null if stream is empty
// or fewer than N such windows can be formed. See PLAN.md Stage 3 for the
// full algorithm.
//
// The past/future boundary is stream[last].month + 1 — the projector
// trusts buildPaystubStream to have truncated to complete months and
// to be calendar-contiguous, which makes `all` calendar-contiguous by
// construction so the array-index DP enforces 12 consecutive calendar
// months naturally.
function projectAfcAtRetirement({ stream, retDate, raises, N, mode, lastDayOfSvc }) {
  if (!stream.length) return null;

  let base = 0;
  for (let i = stream.length - 1; i >= 0; i--) {
    if (stream[i].regular > 0) { base = stream[i].regular; break; }
  }

  const capDate = lastDayOfSvc
    ? new Date(Math.min(lastDayOfSvc.getTime(), retDate.getTime()))
    : retDate;
  const capMonth = new Date(capDate.getFullYear(), capDate.getMonth(), 1);
  const streamEnd   = stream[stream.length - 1].month;
  const futureStart = addMonths(streamEnd, 1);

  const future = [];
  for (let m = new Date(futureStart); m <= capMonth; m = addMonths(m, 1)) {
    let mult = 1;
    for (const { date, rate } of raises) {
      // Skip raises that fall within the paystub coverage period — those
      // are already baked into `base`. Only raises strictly after the
      // last paystub month should compound forward.
      if (date > streamEnd && date <= m) mult *= (1 + rate);
    }
    const v = base * mult;
    future.push({ month: new Date(m), regular: v, total: v });
  }

  const past = stream.filter(s => s.month <= capMonth);
  const all = past.concat(future);

  const score = (m) => mode === 'regular' ? m.regular : m.total;

  const W = all.length - 11;
  if (W < N) return null;

  const sums = new Array(W);
  let s = 0;
  for (let j = 0; j < 12; j++) s += score(all[j]);
  sums[0] = s;
  for (let i = 1; i < W; i++) {
    s += score(all[i + 11]) - score(all[i - 1]);
    sums[i] = s;
  }

  // dp[k][i] = max sum of k non-overlapping 12-month windows whose last
  // selected window starts at index ≤ i. Two windows starting at a, b
  // (a < b) are non-overlapping iff b ≥ a + 12.
  const NEG = -Infinity;
  const dp = Array.from({ length: N + 1 }, () => new Array(W).fill(NEG));
  for (let i = 0; i < W; i++) dp[0][i] = 0;

  for (let k = 1; k <= N; k++) {
    for (let i = 0; i < W; i++) {
      const skip = i > 0 ? dp[k][i - 1] : NEG;
      const prevBest = i - 12 >= 0 ? dp[k - 1][i - 12] : (k === 1 ? 0 : NEG);
      const take = prevBest === NEG ? NEG : prevBest + sums[i];
      dp[k][i] = Math.max(skip, take);
    }
  }

  const total = dp[N][W - 1];
  if (total === NEG) return null;
  return total / (N * 12);
}

// Walk a vacation-hours balance from startDate to endDate, applying the
// year-end carry-over snap (≤ 720 on Jan 1) at each Jan 1 boundary in
// (startDate, endDate]. Mid-month start/end dates are anchored on those
// Jan 1 boundaries rather than walked month-by-month.
//
// At each boundary: accrue monthsBetween(cursor, jan1) months of hours,
// snap to ≤ 720, advance cursor to that Jan 1. After the last boundary
// (or none), accrue the trailing months from cursor to endDate.
//
// `accrualHrsPerMo = 0` yields the "current" curve (snapshot held flat,
// snapped at each Jan 1 if currently > 720). Non-zero yields the
// "accrued" sawtooth.
//
// `excludeFinalSnap`: when `true` AND `endDate` is exactly some Jan 1,
// the snap at THAT boundary is suppressed (earlier Jan 1 snaps within
// the walk still fire). Used to expose the pre-snap year-end peak on
// the vacation chart's Dec 31 rows. No-op when endDate isn't Jan 1.
function snapWalkVacationHours({ startHours, startDate, endDate, accrualHrsPerMo, excludeFinalSnap = false }) {
  if (endDate <= startDate) return Math.max(0, startHours);
  let hours = startHours;
  let cursor = startDate;
  for (let y = startDate.getFullYear() + 1; y <= endDate.getFullYear(); y++) {
    const jan1 = new Date(y, 0, 1);
    if (jan1 > endDate) break;
    hours += accrualHrsPerMo * monthsBetween(cursor, jan1);
    const isFinalBoundary = jan1.getTime() === endDate.getTime();
    if (!(isFinalBoundary && excludeFinalSnap)) {
      hours = Math.min(VACATION_CAP_HOURS, hours);
    }
    cursor = jan1;
  }
  hours += accrualHrsPerMo * monthsBetween(cursor, endDate);
  return Math.max(0, hours);
}

// Vacation lump-sum payout at a candidate retDate.
//   payout = hours-at-retDate × hourly rate at retDate
// where hours-at-retDate comes from `snapWalkVacationHours` — accrual=0
// for the "current" curve (snapshot held flat, snapped to ≤720 at each
// Jan 1 if currently above), accrual=`accrualHrsPerMo` for the "accrued"
// sawtooth. The rate is `hourlyRateAtAsOf` compounded by every raise
// strictly after `vacAsOfDate` and on/before `retDate`.
//
// `vacAsOfDate` is the boundary for the past-raise filter (raises with
// date ≤ vacAsOfDate are already baked into the entered rate). retDates
// before vacAsOfDate degrade safely: snapWalkVacationHours short-circuits
// when endDate ≤ startDate, so the max curve never dips below current.
//
// `cutoff` (optional): mirrors `applyRaises`. When set, both the raise
// projection and the accrual walk are capped at min(cutoff, retDate) —
// raises after separation don't apply and vacation accrual stops at
// last day of service.
function vacationPayoutAt(retDate, { vacHoursAsOf, vacAsOfDate, accrualHrsPerMo, hourlyRateAtAsOf, raises, cutoff = null, excludeFinalSnap = false }) {
  const effDate = cutoff
    ? new Date(Math.min(cutoff.getTime(), retDate.getTime()))
    : retDate;

  let projectedHourlyRate = hourlyRateAtAsOf;
  for (const { date, rate } of raises) {
    if (date > vacAsOfDate && date <= effDate) projectedHourlyRate *= (1 + rate);
  }

  const currentHours = snapWalkVacationHours({
    startHours: vacHoursAsOf, startDate: vacAsOfDate, endDate: effDate, accrualHrsPerMo: 0, excludeFinalSnap,
  });
  const maxHours = snapWalkVacationHours({
    startHours: vacHoursAsOf, startDate: vacAsOfDate, endDate: effDate, accrualHrsPerMo, excludeFinalSnap,
  });

  return {
    currentPayout: currentHours * projectedHourlyRate,
    maxPayout:    maxHours    * projectedHourlyRate,
    projectedHourlyRate,
  };
}

// ── Vacation series (standalone vacation chart) ──────────────────
// Returns either a monthly stairstep series for the vacation chart, or a
// short-circuit summary when the member is already separated (LDOS in past).
//
// Time horizon (active or future-LDOS):
//   today's first-of-month → max(LDOS-month, today+24mo)
//   When future LDOS is within 2 years, the horizon still extends to today+2y
//   so the LDOS marker has room to render. When future LDOS is beyond 2 years,
//   the series stops exactly at the LDOS month.
//
// Already-separated short-circuit:
//   No rows — the chart will render text instead. The summary captures the
//   final payout snapshot at the last day of service.
//
// `raisesNA: true` mirrors the pension-side "Projected raises do not apply"
// override — raises are ignored for hourly-rate projection in that case.
function buildVacationSeries({ vacHours, vacAsOf, vacRate = 14, vacHourlyRate, lastDayOfSvc = null, raisesNA = false }) {
  const today = todayInHST();
  const accrualHrsPerMo = vacRate > 0 ? vacRate : 14;
  const raises = raisesNA ? [] : RAISES;

  if (lastDayOfSvc && lastDayOfSvc < today) {
    const v = vacationPayoutAt(lastDayOfSvc, {
      vacHoursAsOf: vacHours,
      vacAsOfDate: vacAsOf,
      accrualHrsPerMo,
      hourlyRateAtAsOf: vacHourlyRate,
      raises,
      cutoff: lastDayOfSvc,
    });
    const accruedHours = snapWalkVacationHours({
      startHours: vacHours, startDate: vacAsOf, endDate: lastDayOfSvc, accrualHrsPerMo,
    });
    return {
      separated: true,
      separatedOn: lastDayOfSvc,
      finalHours: accruedHours,
      finalRate: v.projectedHourlyRate,
      finalPayout: v.maxPayout,
    };
  }

  const startMonth   = new Date(today.getFullYear(), today.getMonth(), 1);
  const twoYearMark  = addMonths(startMonth, 24);
  const ldosMonth    = lastDayOfSvc
    ? new Date(lastDayOfSvc.getFullYear(), lastDayOfSvc.getMonth(), 1)
    : null;
  const endMonth = ldosMonth && ldosMonth > twoYearMark ? ldosMonth : twoYearMark;

  const rows = [];
  for (let m = startMonth; m <= endMonth; m = addMonths(m, 1)) {
    const v = vacationPayoutAt(m, {
      vacHoursAsOf: vacHours,
      vacAsOfDate: vacAsOf,
      accrualHrsPerMo,
      hourlyRateAtAsOf: vacHourlyRate,
      raises,
      cutoff: lastDayOfSvc,
    });
    rows.push({ retDate: m, currentPayout: v.currentPayout, maxPayout: v.maxPayout });
  }

  // Insert one Dec 31 peak row per year-end in [startMonth, endMonth] (and
  // ≤ lastDayOfSvc, since vacation accrual freezes at separation). Each
  // peak row uses retDate = Dec 31 of `y` and is computed by asking
  // vacationPayoutAt for the Jan 1 (y+1) value with `excludeFinalSnap:
  // true`, which captures the post-Dec-accrual / pre-snap balance. This
  // makes the year-end peak hover-discoverable in the chart's tooltip.
  for (let y = startMonth.getFullYear(); y <= endMonth.getFullYear(); y++) {
    const yearEnd = new Date(y, 11, 31);
    if (yearEnd < startMonth || yearEnd > endMonth) continue;
    if (lastDayOfSvc && yearEnd > lastDayOfSvc) continue;
    const v = vacationPayoutAt(new Date(y + 1, 0, 1), {
      vacHoursAsOf: vacHours,
      vacAsOfDate: vacAsOf,
      accrualHrsPerMo,
      hourlyRateAtAsOf: vacHourlyRate,
      raises,
      cutoff: lastDayOfSvc,
      excludeFinalSnap: true,
    });
    rows.push({ retDate: yearEnd, currentPayout: v.currentPayout, maxPayout: v.maxPayout });
  }
  rows.sort((a, b) => a.retDate - b.retDate);

  return { separated: false, rows, lastDayOfSvc: lastDayOfSvc ?? null };
}

// Hybrid mixed-service benefit: NC-plan years get the 1.25% multiplier
// and the rest get the hybrid multiplier. For non-hybrid plans, ncMonths
// is ignored and the formula collapses to the single-multiplier case.
// Caller invariant: ncMonths ≤ svcMonths (guaranteed by the form, where
// Total = Hybrid + NC and Hybrid ≥ 0).
function blendedBenefit(svcMonths, ncMonths, afc, arf, plan, config) {
  const totalYrs  = svcMonths / 12;
  const ncYrs     = ncMonths / 12;
  const hybridYrs = totalYrs - ncYrs;
  const isHybrid  = plan.startsWith('hybrid');
  const benefit   = isHybrid
    ? afc * ((hybridYrs * config.multiplier) + (ncYrs * 0.0125)) * arf
    : afc * totalYrs * config.multiplier * arf;
  return Math.floor(Math.round(benefit * 100) / 100);
}

// ── Pension series ───────────────────────────────────────────────
// Returns an array of rows, one per candidate retirement month, from the
// 1st of next month through 10 years past the first normal retirement month.
function calculateSeries({ plan, dob, enteredSvcMonths, ncSvcMonths = 0, asOfDate, lastDayOfSvc, afcMonthly, slHours, slRate, slAsOf, paystubStream = null }) {
  const config = PLAN_CONFIGS[plan];
  const today  = todayInHST();
  const start  = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  const rows = [];
  let firstNormalDate = null;

  // Synthetic-stream extrapolation: for regular-mode plans with a manually-
  // entered AFC and no paystubs, build a flat stream pinned at afcMonthly so
  // the projector can apply future raises through the same rolling-window
  // math as the paystub path. Total-mode plans don't get this — their AFC
  // mixes overtime/NR/differentials that don't scale with contract raises.
  const useSynthetic = !paystubStream && config.mode === 'regular' && afcMonthly > 0;
  // Anchor at today for active and committed-COB members so raises landing
  // before lastDayOfSvc still apply (the projector caps at min(lastDayOfSvc,
  // retDate) downstream). Only fall back to lastDayOfSvc when the member is
  // already separated, where no future months should generate raises.
  // `today` is HST midnight already (todayInHST), so it's safe to compare directly.
  const anchorDate = lastDayOfSvc && lastDayOfSvc < today
    ? new Date(lastDayOfSvc.getFullYear(), lastDayOfSvc.getMonth(), 1)
    : new Date(today.getFullYear(), today.getMonth(), 1);
  const effectiveStream = paystubStream && paystubStream.length
    ? paystubStream
    : (useSynthetic ? buildSyntheticStream(afcMonthly, anchorDate, 60) : null);

  // Last month with stream data — raises on or before this date are already
  // baked into `base` and shouldn't count as "in horizon" or be applied by
  // the projector. Null when no stream is driving the calculation.
  const streamEnd = effectiveStream && effectiveStream.length
    ? effectiveStream[effectiveStream.length - 1].month
    : null;

  for (let m = 0; m < 600; m++) {   // 50-year hard ceiling
    const retDate = addMonths(start, m);
    const svcAtM  = serviceAtMonth(enteredSvcMonths, asOfDate, retDate, lastDayOfSvc);
    const ageAtM  = fractionalAge(dob, retDate);

    let isNormal, isEarly, normalRetAge;
    switch (plan) {
      case 'hybrid-post2012':
        // Normal: 65/10 yos OR 60/30 yos.  Early: 55/20 yos.
        isNormal     = (ageAtM >= 65 && svcAtM >= 120) || (ageAtM >= 60 && svcAtM >= 360);
        isEarly      = !isNormal && ageAtM >= 55 && svcAtM >= 240;
        normalRetAge = 65;  // penalty always relative to 65; 60/30 only ends the penalty at 60
        break;
      case 'hybrid-pre2012':
        // Normal: 62/5 yos OR 55/30 yos.  Early: 55/20 yos.
        isNormal     = (ageAtM >= 62 && svcAtM >= 60) || (ageAtM >= 55 && svcAtM >= 360);
        isEarly      = !isNormal && ageAtM >= 55 && svcAtM >= 240;
        normalRetAge = svcAtM >= 360 ? 55 : 62;
        break;
      case 'contributory-post2012':
        // Normal: 60/10 yos.  Early: 55/25 yos.
        isNormal     = ageAtM >= 60 && svcAtM >= 120;
        isEarly      = !isNormal && ageAtM >= 55 && svcAtM >= 300;
        normalRetAge = 60;
        break;
      case 'contributory-pre2012':
        // Normal: 55/5 yos.  Early: any age/25 yos.  Penalty below age 55.
        isNormal     = ageAtM >= 55 && svcAtM >= 60;
        isEarly      = !isNormal && svcAtM >= 300;
        normalRetAge = 55;
        break;
      default: // noncontributory
        // Normal: 62/10 yos OR 55/30 yos.  Early: 55/20 yos.
        isNormal     = (ageAtM >= 62 && svcAtM >= 120) || (ageAtM >= 55 && svcAtM >= 360);
        isEarly      = !isNormal && ageAtM >= 55 && svcAtM >= 240;
        normalRetAge = svcAtM >= 360 ? 55 : 62;
    }

    let pensionCurrentSL = null;
    let pensionProjectedSL = null;
    let pensionRaisesCurrentSL = null;
    let pensionRaisesProjectedSL = null;

    const svcYrs    = Math.floor(svcAtM / 12);
    const eligAge   = primaryEligAge(dob, retDate);
    const arfAge    = primaryArfAge(dob, retDate);
    const offElig   = primaryEligibility(plan, eligAge, svcYrs);
    const arf       = primaryARF(offElig, plan, arfAge.year, arfAge.month);
    const primaryPension = offElig === 'ineligible' ? null
      : blendedBenefit(svcAtM, ncSvcMonths, afcMonthly, arf, plan, config);
    const raisedAfc = effectiveStream && effectiveStream.length
      ? projectAfcAtRetirement({
          stream: effectiveStream, retDate,
          raises: RAISES, N: config.N, mode: config.mode, lastDayOfSvc,
        })
      : null;
    // Gate on actual raise application: raisedAfc > afcMonthly alone isn't
    // enough — even with no raises in scope, a fresh-base future month can
    // pull the top-N average above solveDP's past-only result. Require at
    // least one scheduled raise to land inside the projector's cap *and*
    // be strictly after the paystub stream end (matching the projector's
    // own filter — raises during paystub coverage are already in `base`).
    const raiseCap = lastDayOfSvc
      ? new Date(Math.min(lastDayOfSvc.getTime(), retDate.getTime()))
      : retDate;
    const anyRaiseInHorizon = RAISES.some(r =>
      r.date <= raiseCap && (!streamEnd || r.date > streamEnd));
    const raisesActive = raisedAfc != null && raisedAfc > afcMonthly && anyRaiseInHorizon;
    const hasEffectiveStream = effectiveStream && effectiveStream.length > 0;
    // When a stream is driving the calculation but raises haven't yet lifted
    // the AFC at this row (early retDate before any raise lands, or NR-
    // dominated past), pin pensionWithRaises to primaryPension so the raise
    // curve overlays the primary from the chart's left edge instead of
    // producing a visible gap. When there's no stream at all (manual AFC on
    // a total-mode plan), the raise curve is suppressed entirely (null).
    const pensionWithRaises = offElig === 'ineligible' || !hasEffectiveStream ? null
      : raisesActive
        ? blendedBenefit(svcAtM, ncSvcMonths, raisedAfc, arf, plan, config)
        : primaryPension;

    if (slHours != null && slAsOf != null && offElig !== 'ineligible') {
      const accrualEnd   = lastDayOfSvc
        ? new Date(Math.min(lastDayOfSvc.getTime(), retDate.getTime()))
        : retDate;
      const currentMo    = sickLeaveToMonths(slHours);
      const projectedMo  = sickLeaveToMonths(
        slHours + slRate * Math.max(0, monthsBetween(slAsOf, accrualEnd))
      );
      // SL months credit to the hybrid portion: ncSvcMonths is unchanged,
      // svcMonths grows; blendedBenefit subtracts NC from total to get hybrid.
      pensionCurrentSL   = blendedBenefit(svcAtM + currentMo,   ncSvcMonths, afcMonthly, arf, plan, config);
      pensionProjectedSL = blendedBenefit(svcAtM + projectedMo, ncSvcMonths, afcMonthly, arf, plan, config);
      // Same pin-to-no-raise-baseline logic as pensionWithRaises above: keep
      // the raise+SL curves continuous when raises haven't lifted the AFC.
      if (hasEffectiveStream) {
        pensionRaisesCurrentSL = raisesActive
          ? blendedBenefit(svcAtM + currentMo,   ncSvcMonths, raisedAfc, arf, plan, config)
          : pensionCurrentSL;
        pensionRaisesProjectedSL = raisesActive
          ? blendedBenefit(svcAtM + projectedMo, ncSvcMonths, raisedAfc, arf, plan, config)
          : pensionProjectedSL;
      }
    }

    const status   = isNormal ? 'normal' : isEarly ? 'early' : 'ineligible';
    const isVested = svcAtM >= config.vestingMonths;
    rows.push({ retDate, svcAtM, ageAtM, status, isVested, pensionCurrentSL, pensionProjectedSL, pensionRaisesCurrentSL, pensionRaisesProjectedSL, primaryPension, pensionWithRaises });

    if (status === 'normal' && !firstNormalDate) firstNormalDate = retDate;
    if (firstNormalDate && retDate >= addMonths(firstNormalDate, 120)) break;
  }

  // Already-separated members can no longer accrue service or AFC, and the
  // ARF ramp is just a reminder that delaying collection is better — flatten
  // it by snapping each eligible value to the normal-retirement maximum.
  if (lastDayOfSvc && lastDayOfSvc < today) {
    const snapMax = key => {
      const vals = rows.map(r => r[key]).filter(v => v != null);
      if (!vals.length) return;
      const max = Math.max(...vals);
      for (const row of rows) { if (row[key] != null) row[key] = max; }
    };
    snapMax('primaryPension');
    snapMax('pensionCurrentSL');
    snapMax('pensionProjectedSL');
    snapMax('pensionWithRaises');
    snapMax('pensionRaisesCurrentSL');
    snapMax('pensionRaisesProjectedSL');
  } else if (lastDayOfSvc) {
    // Future-dated lastDayOfSvc: treat it as a committed separation date.
    // The Nov-1-style retirement date (first retDate > lastDayOfSvc) is the
    // canonical pension for that COB; pre-COB rows model retiring earlier
    // (with less service) and post-COB rows model delaying collection (with
    // a smaller ARF penalty), neither of which the user is choosing — so
    // lock every eligible row to the first-row-past-COB value.
    // (ERS rule: retirement date is the 1st of the month and cannot equal
    // the COB date, so a COB of e.g. Oct 31 maps to a Nov 1 retirement date.)
    const snapToCommittedCob = key => {
      let lockValue = null;
      for (const row of rows) {
        if (row.retDate > lastDayOfSvc && row[key] != null) {
          lockValue = row[key];
          break;
        }
      }
      if (lockValue == null) return;
      for (const row of rows) {
        if (row[key] != null) row[key] = lockValue;
      }
    };
    snapToCommittedCob('primaryPension');
    snapToCommittedCob('pensionCurrentSL');
    snapToCommittedCob('pensionProjectedSL');
    snapToCommittedCob('pensionWithRaises');
    snapToCommittedCob('pensionRaisesCurrentSL');
    snapToCommittedCob('pensionRaisesProjectedSL');
  }

  return rows;
}

// ── Paystub pipeline ─────────────────────────────────────────────
// Apply the same filters as findBestIntervals.groovy.
// Returns { stubs, dropped } where dropped is [{ file, reason }].
function filterStubs(paystubs) {
  const dropped = [];
  const stubs   = [];

  for (const s of paystubs) {
    if (s.documentType === 'check') {
      dropped.push({ file: s.file, reason: 'paper check' });
      continue;
    }
    if (!s.payBeginDate || !s.payEndDate) {
      dropped.push({ file: s.file, reason: 'missing dates' });
      continue;
    }
    const earnings = Object.fromEntries(
      Object.entries(s.currentEarnings ?? {}).filter(([k]) => !IGNORED.has(k))
    );
    stubs.push({
      file           : s.file,
      payBeginDate   : s.payBeginDate,
      payEndDate     : s.payEndDate,
      beginDate      : parseDate(s.payBeginDate),
      endDate        : parseDate(s.payEndDate),
      currentEarnings: earnings,
    });
  }

  stubs.sort((a, b) => a.beginDate - b.beginDate);
  return { stubs, dropped };
}

function generateWindows(stubs) {
  if (!stubs.length) return [];

  const firstMonth = new Date(
    stubs[0].beginDate.getFullYear(), stubs[0].beginDate.getMonth(), 1);

  // Find latest stub whose endDate is the last day of its month.
  // Scan backwards (stubs sorted by beginDate ≈ endDate order).
  const isMonthEnd = d => addDays(d, 1).getDate() === 1;
  let lastAnchorEnd = null;
  for (let i = stubs.length - 1; i >= 0; i--) {
    if (isMonthEnd(stubs[i].endDate)) { lastAnchorEnd = stubs[i].endDate; break; }
  }
  // lastMonth = window start such that its endIncl === lastAnchorEnd
  const lastMonth = lastAnchorEnd
    ? addMonths(addDays(lastAnchorEnd, 1), -12)
    : new Date(stubs[stubs.length - 1].beginDate.getFullYear(),
               stubs[stubs.length - 1].beginDate.getMonth(), 1);

  const windows = [];
  let start = new Date(firstMonth);
  while (start <= lastMonth) {
    const endIncl  = addDays(addMonths(start, 12), -1);
    const included = stubs.filter(s => s.beginDate >= start && s.endDate <= endIncl);
    windows.push({ start: new Date(start), endIncl, stubs: included });
    start = addMonths(start, 1);
  }
  return windows;
}

function scoreStub(stub, mode) {
  const e = stub.currentEarnings;
  if (mode === 'regular') return e['Regular'] ?? 0;
  if (mode === 'totalExclVacation') {
    return Object.entries(e).reduce(
      (s, [k, v]) => k === LUMP_SUM_VACATION ? s : s + v, 0);
  }
  // 'total' and 'totalInclVacation' both sum all non-IGNORED earnings.
  // currentEarnings has IGNORED stripped by filterStubs already.
  return Object.values(e).reduce((s, v) => s + v, 0);
}

// Per-calendar-month earnings stream derived from stubs. Each entry is
// { month, regular, total } where month is the 1st of the calendar month
// and regular/total sum scoreStub('regular') / scoreStub('total') over the
// stubs in that month. Stubs never cross calendar-month boundaries (every
// pay period is contained within one calendar month) so each stub maps to
// exactly one month bucket. Months between the earliest and latest stub
// with no stubs are zero-filled. Output is sorted ascending by month.
//
// Trailing months whose pay period isn't fully covered are truncated:
// the stream ends at the latest month containing a stub whose endDate is
// the last day of that month (mirroring generateWindows' lastAnchorEnd
// at lib/pension.js:608-616). Without this, a half-month most-recent stub
// would tank the projector's "current rate" base. Returns [] if no
// month-end-aligned stub exists at all.
function buildPaystubStream(stubs) {
  if (!stubs.length) return [];

  const isMonthEnd = d => addDays(d, 1).getDate() === 1;
  let lastAnchorKey = null;
  for (let i = stubs.length - 1; i >= 0; i--) {
    if (isMonthEnd(stubs[i].endDate)) {
      const d = stubs[i].endDate;
      lastAnchorKey = d.getFullYear() * 12 + d.getMonth();
      break;
    }
  }
  if (lastAnchorKey === null) return [];

  const byMonth = new Map();
  for (const s of stubs) {
    const y = s.beginDate.getFullYear();
    const m = s.beginDate.getMonth();
    const key = y * 12 + m;
    if (key > lastAnchorKey) continue;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(s);
  }

  const first = stubs[0].beginDate;
  const firstKey = first.getFullYear() * 12 + first.getMonth();

  const stream = [];
  for (let key = firstKey; key <= lastAnchorKey; key++) {
    const y = Math.floor(key / 12);
    const m = key % 12;
    const monthStubs = byMonth.get(key) ?? [];
    const regular = monthStubs.reduce((sum, s) => sum + scoreStub(s, 'regular'), 0);
    const total   = monthStubs.reduce((sum, s) => sum + scoreStub(s, 'total'),   0);
    stream.push({ month: new Date(y, m, 1), regular, total });
  }
  return stream;
}

// Synthetic flat stream pinned at `afcMonthly`, used by calculateSeries to
// extrapolate manual-AFC entries on regular-mode plans through the same
// projector path that paystubs use. Returns `monthsBack` entries ending at
// `anchorDate`'s first-of-month, all with regular = total = afcMonthly.
function buildSyntheticStream(afcMonthly, anchorDate, monthsBack = 60) {
  const lastMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const stream = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    stream.push({ month: addMonths(lastMonth, -i), regular: afcMonthly, total: afcMonthly });
  }
  return stream;
}

// Exact DP: O(N × C²). Returns { selected, total } or null if unsolvable.
function solveDP(windows, N) {
  const C    = windows.length;
  const dp   = Array.from({length: N + 1}, () => new Array(C).fill(null));
  const back = Array.from({length: N + 1}, () => new Array(C).fill(-1));

  for (let i = 0; i < C; i++) dp[1][i] = windows[i].score;

  for (let j = 2; j <= N; j++) {
    for (let i = 0; i < C; i++) {
      for (let k = 0; k < i; k++) {
        if (dp[j-1][k] === null) continue;
        if (windows[k].endIncl >= windows[i].start) continue; // overlap
        const candidate = dp[j-1][k] + windows[i].score;
        if (dp[j][i] === null || candidate > dp[j][i]) {
          dp[j][i] = candidate;
          back[j][i] = k;
        }
      }
    }
  }

  let bestEnd = -1, bestTotal = null;
  for (let i = 0; i < C; i++) {
    if (dp[N][i] !== null && (bestTotal === null || dp[N][i] > bestTotal)) {
      bestTotal = dp[N][i]; bestEnd = i;
    }
  }
  if (bestEnd < 0) return null;

  const selected = [];
  let idx = bestEnd;
  for (let j = N; j >= 1; j--) { selected.push(windows[idx]); idx = back[j][idx]; }
  selected.reverse();
  return { selected, total: bestTotal };
}

// Returns an array of { from, to } Date pairs for uncovered spans between stubs.
// The expected cadence is inferred from the median pay-period length, so it
// handles both biweekly and semi-monthly (or any other) schedules.
function detectGaps(stubs) {
  if (stubs.length < 2) return [];

  const lengths = stubs.map(s =>
    Math.round((s.endDate - s.beginDate) / 86400000) + 1
  );
  const sorted    = [...lengths].sort((a, b) => a - b);
  const medianLen = sorted[Math.floor(sorted.length / 2)];
  const threshold = 1 + medianLen * 0.5; // more than half a period = gap

  const gaps = [];
  for (let i = 0; i < stubs.length - 1; i++) {
    const daysBetween =
      Math.round((stubs[i + 1].beginDate - stubs[i].endDate) / 86400000);
    if (daysBetween > threshold) {
      gaps.push({
        from: addDays(stubs[i].endDate, 1),
        to:   addDays(stubs[i + 1].beginDate, -1),
      });
    }
  }
  return gaps;
}

// ── Module exports (Node only) ───────────────────────────────────
// Browser load is a classic <script> tag, so top-level declarations are
// already globals; this block only fires under CommonJS.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    // Constants
    IGNORED, LUMP_SUM_VACATION, PRE_1971_DATE, RAISES, TIER_BOUNDARY,
    VACATION_CAP_HOURS, PLAN_CONFIGS, PRIMARY_ARF_TABLES,
    // Plan logic
    derivePlanKey, primaryArfAge, primaryEligAge, primaryEligibility, primaryARF,
    isPre1971DualMethod,
    // Date utilities
    todayInHST, toYmd, parseDate, addMonths, addDays, fmtDate, monthsBetween, fractionalAge,
    parseIsoDate, serviceAtMonth, sickLeaveToMonths,
    // Math
    applyRaises, projectAfcAtRetirement, snapWalkVacationHours, vacationPayoutAt, buildVacationSeries, blendedBenefit, calculateSeries,
    // Paystub pipeline
    filterStubs, generateWindows, scoreStub, buildPaystubStream, buildSyntheticStream, solveDP, detectGaps,
  };
}
