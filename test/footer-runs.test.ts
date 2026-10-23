// Unit tests for the footer row's tone-run coalescing (0.7.35). The footer
// used to be one <text> with one fg; showing a stale rate "dimmed" requires
// splitting the row into runs, and the separator arithmetic is the part that
// would silently regress the row's spacing — so it is pinned here.
import { test } from "node:test"
import assert from "node:assert/strict"
import { coalesceFooterRuns } from "../src/footer-runs.ts"

test("coalesceFooterRuns collapses an all-normal row into a single run", () => {
  const runs = coalesceFooterRuns([
    { text: "⏱ 12s" },
    { text: "⚡ 45 tok/s" },
    { text: "Σ 1.2M" },
  ])
  // One run: the whole row is one tone, so a single <text> carries it.
  assert.equal(runs.length, 1)
  assert.equal(runs[0].text, "⏱ 12s   ⚡ 45 tok/s   Σ 1.2M")
  assert.equal(runs[0].dim, undefined)
})

test("coalesceFooterRuns splits only at a tone change and keeps the gap", () => {
  const runs = coalesceFooterRuns([
    { text: "⏱ 12s" },
    { text: "⚡ 45 tok/s", dim: true },
    { text: "Σ 1.2M" },
  ])
  assert.equal(runs.length, 3)
  // The first run has no leading gap; every later run carries the gap itself.
  assert.equal(runs[0].text, "⏱ 12s")
  assert.equal(runs[1].text, "   ⚡ 45 tok/s")
  assert.equal(runs[1].dim, true)
  assert.equal(runs[2].text, "   Σ 1.2M")
  assert.equal(runs[2].dim, undefined)
})

test("coalesceFooterRuns keeps the stale run last when only it is dim", () => {
  const runs = coalesceFooterRuns([{ text: "⏱ 12s" }, { text: "⚡ 45 tok/s", dim: true }])
  assert.equal(runs.length, 2)
  assert.equal(runs[0].text, "⏱ 12s")
  assert.equal(runs[1].text, "   ⚡ 45 tok/s")
  assert.equal(runs[1].dim, true)
})

test("coalesceFooterRuns handles an empty row", () => {
  assert.deepEqual(coalesceFooterRuns([]), [])
})

test("coalesceFooterRuns never loses or reorders text", () => {
  const segments = [
    { text: "⏱ 3s" },
    { text: "⚡ 10 tok/s", dim: true },
    { text: "hit·s 42.0%" },
    { text: "hit 51.5%" },
  ]
  const runs = coalesceFooterRuns(segments)
  // Rejoining the runs and dropping the run-leading gaps must reproduce the
  // original three-space-joined row exactly.
  const rejoined = runs.map((run, index) => (index === 0 ? run.text : run.text.slice(3))).join("   ")
  assert.equal(rejoined, segments.map((segment) => segment.text).join("   "))
})
