# PLAN.md

## Stage 1: Persistent paystub fixture cache

Add a `?fixture` URL flag that makes the calculator persist the parsed
paystub state to `localStorage` after a successful paystub load and
restore it on reload. Eliminates the click-the-picker step during
iterative testing on a single browser/machine where the user owns the
cache.

The flag is boolean (no value needed). The cache key is a single
constant — there's no per-fixture name, since the user isn't sharing the
browser and one slot is enough.

### Stage 1.1: Refactor paystub-load + add cache helpers

- Add `fixture` to `SUPPORTED_PARAMS` (`index.html:1751`) as a boolean
  flag (presence-only; ignore any value).
- Module-scope constant: `const PAYSTUB_FIXTURE_KEY = 'paystubFixture';`
- Module-scope flag at init: `const fixtureMode = urlParams.has('fixture');`
- Factor out the post-paystub-success block (currently inline at
  `index.html:777+` — sets `lastStubs`, `lastWindows`,
  `_debug.lastPaystubStream`, calls `computeAndFillAfc`, updates the
  paystubs-section UI text) into a function:

      function applyLoadedStubs(stubs, { fromCache = false, cachedAt = null } = {}) { … }

  The call site that runs after the picker's `scanPaystubs` resolves
  becomes a single `applyLoadedStubs(stubs)` invocation (`fromCache`
  defaults to `false`).
- Helpers (small, inline in `index.html`):
  - `function persistFixture(stubs)` — `JSON.stringify({ cachedAt: new
    Date().toISOString(), stubs })`, write to
    `localStorage[PAYSTUB_FIXTURE_KEY]`. No-op if `!fixtureMode`.
  - `function clearFixture()` — `localStorage.removeItem(...)`. Always
    runs (no `fixtureMode` gate — user may toggle the flag across
    sessions; safest to honor "clear" requests unconditionally).
  - `function loadFixture()` — read + `JSON.parse`; if shape is invalid,
    `console.warn`, return `null`. On valid load, hydrate
    `beginDate`/`endDate` on each stub (`new Date(s.beginDate)`); also
    parse `cachedAt` to a Date. Returns `{ stubs, cachedAt } | null`. |

Success: existing flows unchanged when `?fixture` is absent. With
`?fixture` set, after a successful paystub load,
`localStorage.getItem('paystubFixture')` returns a JSON blob with
`cachedAt` and `stubs`.

### Stage 1.2: Restore on init

- After URL pre-fill runs (`index.html:1745+`) and after `pension.js`
  globals are available: if `fixtureMode && loadFixture()` returns a
  hit, call `applyLoadedStubs(stubs, { fromCache: true, cachedAt })`.
- Restoration order matters: it must run **after** the form fields are
  pre-filled (so plan/dob/memDate etc. are set, allowing
  `computeAndFillAfc` to derive the right plan key) but **before**
  `maybeCalculate()` would auto-fire, so the AFC field is populated
  first.
- If the restore throws (parse error, missing helper, etc.), log and
  fall through to normal "no cache" behavior. |

Success: `file://…/index.html?fixture&plan=hybrid&memDate=…&dob=…&svcAsOf=…`
with a populated cache opens straight to a fully-calculated graph; no
click on the picker required. With cache absent or malformed, behaves
identically to a no-`fixture` URL.

### Stage 1.3: Invalidation triggers

Two sites must clear the cache:

1. **`runClear` (`index.html:1421+`)** — append `clearFixture()` to the
   existing reset block. Belongs alongside `lastStubs = []` and the
   debug-panel reset.
2. **Picker change handler** — at the top of the change-listener
   callback (`index.html:` near where `lastStubs = []` is set in the
   pre-scan reset, around `:698`), call `clearFixture()` **before**
   scanning starts. Rationale per user spec: when the user picks a new
   directory, the old cache is stale and should not survive the act of
   picking. If the scan succeeds, Stage 1.1's `persistFixture` rewrites
   it; if the scan is cancelled or errors, the cache stays cleared, and
   the next `?fixture` reload behaves like a fresh session. |

Success: `localStorage.getItem('paystubFixture')` returns `null` after
either trigger fires.

### Stage 1.4: UI — show the cached datetime in the paystubs section

- Add a `<span id="paystub-cache-info"></span>` adjacent to the existing
  `pickerPath` element in the paystubs section (search `index.html` for
  `pickerPath` to find the right markup site).
- Style: small, muted (e.g. `font-size: 0.7rem; color: #888;`), matching
  the existing `raises-applies-row` style.
- Set its `textContent`:
  - On cache restore (`applyLoadedStubs(..., { fromCache: true,
    cachedAt })`): `"loaded from summaries cached at: ${formatLocal(cachedAt)}"`,
    where `formatLocal` produces `YYYY-MM-DD HH:MM` in local time.
  - On a fresh successful paystub pick: clear (empty string).
  - On `runClear`: clear. |

Success: when restoring from cache, the user sees a "loaded from cache:
2026-05-06 14:32" label below the directory-picker UI; when picking
fresh paystubs, the label clears.

### Stage 1.5: Browser smoke

1. Open without `?fixture`, load paystubs normally →
   `localStorage.getItem('paystubFixture')` is `null`. No cache-info
   label visible.
2. Reload with `?fixture` appended, load paystubs → after success,
   `localStorage` has the entry; cache-info label is empty (fresh load,
   not from cache).
3. Reload again with `?fixture` (no clear) → page opens with chart
   already drawn, no picker click; cache-info label shows "loaded from
   cache: …" with the prior load's timestamp.
4. From state (3), click "Clear all fields" →
   `localStorage.getItem('paystubFixture')` is `null`; cache-info label
   gone; form is empty.
5. Reload with `?fixture` after (4) → no cache; behaves like a fresh
   session (picker click required again).
6. From state (3) again, click the directory picker and pick a
   directory: **before** scanning starts, the cache is cleared; on
   successful scan, the new cache is written. Cancel mid-scan → cache
   stays cleared. |

Status: 1.1 / 1.2 / 1.3 / 1.4 / 1.5 — Not Started

---

## Notes

- The cache contains personal earnings data (regular pay, OT, etc.).
  `localStorage` is appropriate for a single-user dev machine; not
  shared, not exfiltrated.
- Storage size: roughly 50-200 KB JSON for ~90 stubs (key/value text;
  Date objects auto-serialize to ISO strings via `JSON.stringify`).
  `localStorage` per-origin quota is ~5-10 MB, comfortably above.
- Date hydration on restore: must walk the stubs array and replace
  `beginDate`/`endDate` strings with `new Date(...)` calls. JSON.parse
  alone leaves them as strings, which would silently break downstream
  consumers (`buildPaystubStream`, `generateWindows`, `solveDP`, the
  projector).
- After Stage 1.5 lands, update `notes.md` with a `&fixture` URL for the
  iteration loop. PLAN.md is ephemeral — delete after success.
