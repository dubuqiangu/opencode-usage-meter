// Unit tests for the footer row's tone-run coalescing (0.7.35). The footer
// used to be one <text> with one fg; showing a stale rate "dimmed" requires
// splitting the row into runs, and the separator arithmetic is the part that
// would silently regress the row's spacing — so it is pinned here.
import { test } from "node:test"
import assert from "node:assert/strict"
import { coalesceFooterRuns, composeFooterSegments } from "../src/footer-runs.ts"
import type { FooterSegmentSources } from "../src/footer-runs.ts"

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

// composeFooterSegments: the branch selection lifted out of
// components/footer-status.tsx (0.7.38). Defaults produce the empty state;
// every test overrides only what it exercises.
const newFooterSources = (
  overrides: Partial<FooterSegmentSources> = {},
): FooterSegmentSources => ({
  now: 20_000,
  running: false,
  started: undefined,
  last: undefined,
  exactRate: undefined,
  avgRate: undefined,
  liveTokensPerSecond: undefined,
  calibrationFactor: 1,
  liveMemory: new Map(),
  sessionID: "ses_footer",
  footerSigmaEnabled: false,
  totalScope: "today",
  scopeStats: undefined,
  footerHitEnabled: false,
  hitScope: "today",
  readSessionTokens: () => undefined,
  todayStats: undefined,
  ...overrides,
})

test("composeFooterSegments returns null when there is nothing to show", () => {
  assert.equal(composeFooterSegments(newFooterSources()), null)
})

test("composeFooterSegments picks exactly one of ⏱ / ⏳ / 🏁", () => {
  // ⏱ wins while a turn is running with a start timestamp.
  assert.deepEqual(
    composeFooterSegments(newFooterSources({ running: true, started: 8_000 })),
    [{ text: "⏱ 12.0s" }],
  )
  // ⏳ when running without a start timestamp.
  assert.deepEqual(composeFooterSegments(newFooterSources({ running: true })), [{ text: "⏳" }])
  // 🏁 when idle with a finished duration; the running branch must not leak.
  assert.deepEqual(
    composeFooterSegments(newFooterSources({ running: true, started: 8_000, last: 5_000 })),
    [{ text: "⏱ 12.0s" }],
  )
  assert.deepEqual(composeFooterSegments(newFooterSources({ last: 5_000 })), [
    { text: "🏁 5.0s" },
  ])
})

test("composeFooterSegments settles the idle ⚡ from exact then avg", () => {
  assert.deepEqual(
    composeFooterSegments(newFooterSources({ last: 5_000, exactRate: 42 })),
    [{ text: "🏁 5.0s" }, { text: "⚡ 42 tok/s" }],
  )
  assert.deepEqual(
    composeFooterSegments(newFooterSources({ last: 5_000, avgRate: 30 })),
    [{ text: "🏁 5.0s" }, { text: "⚡ 30 tok/s avg" }],
  )
})

test("composeFooterSegments floors a calibrated live rate at 1 (0.7.38 B2)", () => {
  const liveMemory = new Map()
  const segments = composeFooterSegments(
    newFooterSources({
      running: true,
      started: 8_000,
      liveTokensPerSecond: 1,
      calibrationFactor: 0.25,
      liveMemory,
    }),
  )
  assert.deepEqual(segments, [{ text: "⏱ 12.0s" }, { text: "⚡ 1 tok/s" }])
  // The held memory must store the non-zero value too, so a following stale
  // tick cannot revive the impossible "0 tok/s".
  assert.equal(liveMemory.get("ses_footer")?.tokensPerSecond, 1)
  assert.ok(!(segments ?? []).some((segment) => segment.text.includes("0 tok/s")))
})

test("composeFooterSegments marks a held-but-stale live rate dim", () => {
  const liveMemory = new Map([["ses_footer", { turnStartedAt: 8_000, tokensPerSecond: 45 }]])
  const segments = composeFooterSegments(
    newFooterSources({
      running: true,
      started: 8_000,
      liveTokensPerSecond: undefined,
      liveMemory,
    }),
  )
  assert.deepEqual(segments, [{ text: "⏱ 12.0s" }, { text: "⚡ 45 tok/s", dim: true }])
})

test("composeFooterSegments keeps Σ strictly before hit (both scopes)", () => {
  const scopeStats = { tokens: { input: 1_000, output: 0, reasoning: 0 } }
  const sessionSegments = composeFooterSegments(
    newFooterSources({
      running: true,
      started: 8_000,
      footerSigmaEnabled: true,
      scopeStats,
      footerHitEnabled: true,
      hitScope: "session",
      readSessionTokens: () => ({ input: 5, cache: { read: 5, write: 0 } }),
    }),
  )
  assert.deepEqual(sessionSegments, [
    { text: "⏱ 12.0s" },
    { text: "Σ 1.0k" },
    { text: "hit·s 50.0%" },
  ])
  const dailySegments = composeFooterSegments(
    newFooterSources({
      running: true,
      started: 8_000,
      footerSigmaEnabled: true,
      scopeStats,
      footerHitEnabled: true,
      hitScope: "today",
      todayStats: { tokens: { input: 50, cache: { read: 50 } } },
    }),
  )
  assert.deepEqual(dailySegments, [
    { text: "⏱ 12.0s" },
    { text: "Σ 1.0k" },
    { text: "hit 50.0%" },
  ])
})

test("composeFooterSegments tags a non-today Σ scope and gates opt-in segments", () => {
  const scoped = composeFooterSegments(
    newFooterSources({
      running: true,
      started: 8_000,
      footerSigmaEnabled: true,
      totalScope: "7d",
      scopeStats: { tokens: { input: 1_000, output: 0, reasoning: 0 } },
    }),
  )
  assert.deepEqual(scoped, [{ text: "⏱ 12.0s" }, { text: "Σ 1.0k (7d)" }])
  // Opt-in gate off: even with stats present nothing extra is pushed.
  const gated = composeFooterSegments(
    newFooterSources({
      running: true,
      started: 8_000,
      scopeStats: { tokens: { input: 1_000, output: 0, reasoning: 0 } },
      todayStats: { tokens: { input: 50, cache: { read: 50 } } },
    }),
  )
  assert.deepEqual(gated, [{ text: "⏱ 12.0s" }])
})
