// Unit tests for src/hit-rate.ts — the cache-hit ratios shared by the footer
// Σ/hit segments, the right-sidebar metrics block and the /usage-full detail
// tables (v0.7.27 extraction; the three surfaces used to carry private copies
// of the same arithmetic). These pin the two formulas, their undefined edge,
// and the display rounding each call site keeps on top of the raw ratio.
import { test } from "node:test"
import assert from "node:assert/strict"
import { dailyHitRatio, sessionHitRatio } from "../src/hit-rate.ts"

test("sessionHitRatio uses the strict read / (input + read + write) denominator", () => {
  assert.equal(sessionHitRatio(50, 50, 0), 0.5)
  assert.equal(sessionHitRatio(60, 20, 20), 0.6)
  // Cache writes count in the denominator even when nothing was read.
  assert.equal(sessionHitRatio(0, 0, 100), 0)
})

test("sessionHitRatio is undefined when there is no input context at all", () => {
  assert.equal(sessionHitRatio(0, 0, 0), undefined)
})

test("dailyHitRatio uses the read / (read + input) denominator", () => {
  assert.equal(dailyHitRatio(75, 25), 0.75)
  assert.equal(dailyHitRatio(40, 0), 1)
  // read = 0 with real input is a 0% hit rate, not "no data".
  assert.equal(dailyHitRatio(0, 100), 0)
})

test("dailyHitRatio is undefined when there is nothing to rate", () => {
  assert.equal(dailyHitRatio(0, 0), undefined)
})

test("call-site display rounding is preserved on top of the raw ratio", () => {
  // Panel tables render an integer percent; the live surfaces render one
  // decimal (an integer percent looks frozen while the counts move).
  assert.equal(Math.round(sessionHitRatio(1, 2, 0)! * 100), 33)
  assert.equal((dailyHitRatio(1, 2)! * 100).toFixed(1), "33.3")
})
