# Resume notes — vacation/pension raises-NA two-checkbox revert

Mid-conversation pause to switch machines. **All work is uncommitted** — per CLAUDE.md global instructions I can't run git writes, so you'll need to stage / commit / push from this machine and pull on the other before resuming.

## Branch / commit state

- Branch: `vacation`
- Tip: `b663be6 checkpoint: OOT`
- Uncommitted (mixed staged + unstaged): `CLAUDE.md`, `PLAN.md`, `NEXT.md`, `index.html`. `RESUME.md` is currently deleted in the working tree — this file replaces it. `notes.md` is untracked.
- Recommended pre-switch steps: `git add -A && git commit -m "checkpoint: vacation raises-NA revert WIP" && git push` (these are user-action steps; I can't run them).

## What's landed in this session (per `PLAN.md`)

All marked **Complete (pending manual browser verification)**:

- **Stages 1–4** — Clear-button re-scoping (pension/vacation clears now independent).
- **Stages 4.5, 4.6** — Vacation-scoped error banner; pension-clear stopped blanking vacation chart (recomputes instead).
- **Stages 5+6 (combined)** — Replaced `#vac-raises-na` checkbox with a passive notice + one-way pension→vacation sync. **NOTE: this is being reverted by Stages 9+.**
- **Stage 7** — CLAUDE.md cleanup for the (now-being-reverted) one-way model.
- **Stage 8a** — `updateContractualVisibility()` helper: contractual fieldset now visible when pension uses raises OR vacation can graph; `#raises-note` informational div added.

No commits have been made during this session — all work is in the working tree.

## What's pending (in order)

Detail in `PLAN.md`. High-level:

- **Stage 8b** — CLAUDE.md cleanup for Stage 8a's visibility changes. (Could be folded into Stage 13.)
- **Stages 9a, 9b** — Revert Stages 5+6: bring back the standalone `#vac-raises-na` checkbox + label; rewire `runVacationCalculate` to read it; drop `updateVacRaisesNotice` and the one-way sync. Two checkboxes are intentionally allowed to diverge.
- **Stages 10a, 10b, 10c** — Add the pension-side "no projection" auto-lock. 10a refactors `applyRaisesNALock` to take `{ pensionUsesRaises, noRaisesApply }` and adds `RAISES_NA_NOPROJ_SUFFIX = " — pension AFC isn't projecting raises with the current inputs"`. 10a *also* drops `raisesTableRowEl.hidden = …` from the lock function (per user direction, table stays visible whenever fieldset is). 10b drives the lock from `updateContractualVisibility` so it stays current outside `runCalculate`. 10c removes the inline `<script>` listener at `index.html:509-515` that hides the table when the user manually checks the pension checkbox (further decoupling).
- **Stage 11** — Add the vacation-side "lastDay-cutoff" auto-lock via new `applyVacRaisesNALock()`. Trigger: `canCalculateVacation && lastDay set && !RAISES.some(r => r > vacAsOf && r <= lastDay)`. Suffix: verbatim `" due to the Last day of service above"` (since `lastDay` lives in the pension form visually above the vacation checkbox).
- **Stage 12** — Reword `#raises-note` to drop redundancy with the new pension NOPROJ suffix:
  > These raises are projected through the vacation hourly rate. Load paystubs above to also project them through pension AFC.
- **Stage 13** — Final CLAUDE.md doc cleanup covering Stages 9–12 + the table-visibility decoupling from Stages 10a/10c.

## Open decisions / agreements from this session

- **Two checkboxes, no sync** — User explicitly accepts that pension and vacation raises-NA checkboxes can diverge.
- **Vacation defaults** — Vacation checkbox defaults unchecked (raises apply).
- **Pension default behavior** — Pension checkbox checked + disabled unless pension info supports projection (no paystubs AND not regular-mode-with-manual-AFC).
- **Suffix wordings** — Both confirmed verbatim:
  - Pension NOPROJ: `" — pension AFC isn't projecting raises with the current inputs"`
  - Vacation LASTDAY: `" due to the Last day of service above"` (verbatim reuse of pension's existing constant)
- **Vacation lock trigger** — Confirmed: `lastDay` set + no raise dates in `(vacAsOf, lastDay]`. Independent of pension's `noRaisesApply`.
- **Table visibility** — Decoupled from both checkboxes. Visible whenever the contractual fieldset is visible, full stop.
- **`#raises-note` kept** — Even with the new pension suffix carrying the "isn't applying" half, the note's "raises *are* applying to vacation; here's how to enable pension" framing has unique value. Reworded in Stage 12.

## Manual browser verification still owed

Per resume-notes pattern from earlier in the session, all 75 unit tests pass after every completed stage but **no manual browser verification has been performed for Stages 1–8a**. When resuming, before pushing into Stage 8b/9+, run through the verification paths spelled out in `PLAN.md` per stage. Key smoke tests:

1. `node --test tests/*.test.js` — should report 75 pass / 0 fail.
2. Open `index.html` with no params — both charts render empty axes; both clear buttons no-op.
3. Open `index.html` with both pension + vacation URL params — verify each clear button scopes correctly; URL reflects surviving fields.
4. Bad URL params (e.g., `?vacHours=-5&memDate=invalid`) — pension error in top banner; vacation error in the vacation-scoped banner above `#group-vacation-input`.
5. Toggle `#raises-na` — vacation chart recomputes; (current pre-Stage-9 state: passive vacation-side notice mirrors it). Post-Stage-9: vacation checkbox is independent and user-only.
6. Set a `lastDay` that cuts off all raises — pension checkbox auto-locks with LASTDAY suffix.
7. With a `mode: 'total'` plan (e.g., `noncontributory`) + manual AFC + vacation inputs — Stage 8a state: contractual fieldset visible, `#raises-note` shown, RAISES table visible. (Once Stage 10a lands: pension checkbox additionally locked + disabled + NOPROJ suffix.)

## Pointers for the next session

- Start by re-reading `PLAN.md` end-to-end — Stages 9–13 carry the detailed implementation steps and verification paths.
- Per `feedback_stage_verification.md` in auto-memory: pause after each stage and wait for user OK.
- Per `project_planning_files.md`: `PLAN.md` and this `RESUME.md` are ephemeral — delete when the final stage lands.
- The user's earlier message about RAISES table visibility ("even when raises can't be applied to the pension graph, I kind of want the disabled raises table itself visible") is the key driver of Stages 10a + 10c. Don't quietly re-couple table visibility to lock state.
