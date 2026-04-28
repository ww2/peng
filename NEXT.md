# Next Session: ARF-ramp flattening for future-dated lastDayOfSvc

## Status

- Prior session: Service Date UX redesign (split `svc-as-of` from `last-day`, "Still active" checkbox, accrual ramp through last-day, raises capped at last-day) — **complete**, all in `index.html`, uncommitted.
- This session: started a follow-up fix for the ARF ramp continuing past `lastDayOfSvc` — **partially implemented, target value needs correcting**. See "Open issue" below.

## The follow-up bug (current thread)

Test URL:
```
?plan=noncontributory&dob=1966-05-01&svcYears=23&svcMonths=9&svcAsOf=2026-01-31&lastDay=2026-10-31&afc=10078.67&slHours=2124&slAsOf=2026-05-01
```

User expected the pension to stop growing after `lastDayOfSvc` (2026-10-31). It didn't — it kept rising through May 2028 ($2,808 → $3,086).

Root cause: `svcAtM`, `afcMonthly`, and SL months are correctly capped at `lastDayOfSvc`, but `arf = primaryARF(…, primaryArfAge(dob, retDate))` (`index.html:1170-1172`) still uses age at `retDate`, so the early-retirement penalty keeps shrinking until age 62 (2028-05-01).

The pre-existing `snapMax` block (intended for past-separated members) was gated on `lastDayOfSvc < todayMidnight`, so it didn't fire here.

## Already done this session

Added a future-dated branch to the snap block at `index.html:1207-1242`:

```js
} else if (lastDayOfSvc) {
  // Future-dated lastDayOfSvc: treat it as both separation and collection
  // start. Service/AFC/SL are already capped at lastDayOfSvc upstream, but
  // ARF keeps improving with age — flatten that by snapping each row whose
  // retDate > lastDayOfSvc to the value at the last retDate ≤ lastDayOfSvc.
  const snapAfterLastDay = key => {
    let lockValue = null;
    for (const row of rows) {
      if (row.retDate <= lastDayOfSvc) {
        if (row[key] != null) lockValue = row[key];
      } else if (row[key] != null && lockValue != null) {
        row[key] = lockValue;
      }
    }
  };
  snapAfterLastDay('primaryPension');
  snapAfterLastDay('pensionCurrentSL');
  snapAfterLastDay('pensionProjectedSL');
  snapAfterLastDay('pensionWithRaises');
  snapAfterLastDay('pensionRaisesCurrentSL');
  snapAfterLastDay('pensionRaisesProjectedSL');
}
```

Past-separated branch (`lastDayOfSvc < todayMidnight`) is unchanged: still snap-to-max.

## Open issue — wrong snap target

The current implementation locks to the **last `retDate ≤ lastDayOfSvc`** (= Oct 1 2026 row, $2,783).

But ERS docs make clear that's the wrong target:

> "All retirement dates must be the first of the month except for December when retirement may be on the 1st or 31st." — `info/Retirement-Information-Noncontributory-eff.-6.2022.md:45`

> "Your last day on the payroll is your COB date. Your retirement date must be the 1st of the month except December, which can be the 1st or the 31st. **Your COB date and retirement date cannot be the same.**" — same file, lines 55-57

Confirmed by the user against the official estimator: its retirement-date pulldown only offers month-name + "1", plus a single "December 31" entry.

So `lastDayOfSvc` = COB date (e.g., Oct 31). The corresponding retirement date (collection start) is Nov 1 — represented in our series by the **first `retDate > lastDayOfSvc`** row (Nov 2026, $2,808). That's the row where service has fully accrued through `lastDayOfSvc`. The Oct 1 row models retiring before working through October, which contradicts the user's stated last day.

## To do

1. Change the snap target in `index.html:1207-1242` from "last retDate ≤ lastDayOfSvc" to "first retDate > lastDayOfSvc". Sketch:
   ```js
   const snapAfterLastDay = key => {
     // Find the first row past lastDayOfSvc with a non-null value; lock to it.
     let lockValue = null;
     for (const row of rows) {
       if (row.retDate > lastDayOfSvc && row[key] != null) {
         lockValue = row[key];
         break;
       }
     }
     if (lockValue == null) return;
     for (const row of rows) {
       if (row.retDate > lastDayOfSvc && row[key] != null) row[key] = lockValue;
     }
   };
   ```
   Apply to all six pension keys (same list as current).

2. **Consider also flattening `retDate ≤ lastDayOfSvc` rows.** The user said they want to treat `lastDayOfSvc` as both separation and collection start. By that logic, rows with `retDate ≤ lastDayOfSvc` (which model "retire earlier than planned") may also be misleading. But the user's literal request was only about post-`lastDayOfSvc` rows, so leave this out unless asked. Flag it in the response.

3. Verify with the test URL above: after the fix, every row from Nov 2026 onward should display the same value (~$2,808 estimated, ~$2,820 with raises), and the chart's red-curve / table tail should collapse to the "Values become fixed after the above date" sentinel at the Nov 2026 row.

4. Edge case: when no row has `retDate > lastDayOfSvc` (would only happen if the 50-yr ceiling somehow truncates before then — effectively impossible), `lockValue` stays null and nothing snaps. Acceptable; document with a one-line comment if the reviewer asks.

## Out of scope

- No change to the past-separated branch (`lastDayOfSvc < todayMidnight`) — keep snap-to-max.
- No pension-math changes; `serviceAtMonth`, `applyRaises`, `primaryARF` all stay as-is.
- December-31 retirement edge case (the one official-estimator exception): not handled specially; if the user enters `lastDay=2026-12-31`, the existing logic still works because Dec 31 > Dec 1 row, and the Jan 1 2027 row will be the snap target. Don't add custom Dec-31 handling unless a real bug appears.

## Files

- `index.html:1207-1242` — the snap block (current implementation here, needs the target swap from To-do #1).
- `info/Retirement-Information-Noncontributory-eff.-6.2022.md:45-57` — ERS-doc evidence for the snap-target choice.
- `PLAN.md` — independent (mixed-service / NC-upgrade work), unrelated to this thread.

