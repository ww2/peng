# Compressed X Axis — Implementation Plan

Ineligible zones ("Not yet vested", "Vested, not yet eligible") are visually
uninteresting. This plan compresses them to a fixed narrow width so the
eligible zone fills most of the chart. Year labels at the zone boundaries
convey the date ranges; rotated type labels inside the bands identify them.

---

## Stage 1: Custom segmented xScale + tick generation update

**Status:** Complete

What was done:
- Replaced `d3.scaleTime()` with a custom piecewise `xScale` function. Each ineligible zone maps to `COMPRESS_PX = 56` pixels; the eligible zone fills `iW - n * COMPRESS_PX`.
- `compressedSegs` built from `firstVestedDate` / `firstEligibleDate` lookups on the series; 0, 1, or 2 segments depending on member state.
- `xScale.invert` handles both the compressed and eligible zones for tooltip hover.
- Tick generation (`xMajorVals`, `xMinorVals`) restricted to the eligible zone (`eligFromDate` onwards).
- `labelEvery` computed from `eligPxWidth / eligYearSpan` so label spacing is based on the eligible zone width, not the full chart width.
- `xMin` year label and tick rendered unconditionally (left-anchored at x=0) for all cases, including already-eligible members with no compressed zones.
- Zone transition labels (centered, one per `seg.to`) and tick marks rendered only when `compressedSegs.length > 0`.
- `boundaryXs` (used for regular-tick collision suppression) always includes `xScale(xMin)`, regardless of whether compressed zones exist.

**Test params:**
- Already-eligible: `plan=hybrid-post2012&dob=1975-06-15&svcYears=15&svcMonths=3&svcAsOf=2024-01-01&afc=4500` — one narrow "Vested, not yet eligible" band; year labels at left edge and transition; no collision with first regular tick.
- Young person: `plan=hybrid-post2012&dob=1995-01-01&svcYears=5&svcMonths=0&svcAsOf=2024-01-01&afc=4000` — two narrow bands; year labels at all three boundaries.
- Already-vested/already-eligible (no compressed zones): xMin year label still appears at the left edge.

---

## Stage 2: Date-range labels for compressed zones

**Status:** Superseded — not implemented. The year labels added to the X axis
in Stage 1 already convey the date range for each compressed zone. The
original rotated type text ("Not yet vested" / "Vested, not yet eligible") was
retained unchanged.

---

## Stage 3: Break indicator at the compressed / eligible boundary

**Goal:** Draw a small zigzag (`//`-style) on the X axis baseline at
`x = eligPxStart` to mark the scale discontinuity.

**Implementation:**

```js
if (eligPxStart > 0) {
  const bx = eligPxStart, by = 0, h = 6, w = 4;
  g.append('polyline')
    .attr('points', [
      [bx - w,  h/2],
      [bx,     -h/2],
      [bx + w,  h/2],
      [bx + 2*w,-h/2],
    ].map(p => p.join(',')).join(' '))
    .attr('fill', 'none')
    .attr('stroke', CHART.colorAxis)
    .attr('stroke-width', 1.5);
}
```

Draw this in the X-axis `<g>` layer after the axis baseline, so it sits on
top of the axis line.

**Status:** Not Started

**Success criteria:**
- Young-person params: a clear `//` zigzag appears at the right edge of the compressed zone where the eligible zone begins.
- Normal params: no zigzag is drawn (`eligPxStart === 0`).
