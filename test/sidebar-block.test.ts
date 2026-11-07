// Unit tests for src/sidebar-block.ts — the right-sidebar block's visibility
// gate (shouldShowSidebarBlock) and its line assembly (composeSidebarBlock),
// lifted out of components/sidebar-metrics.tsx in 0.7.38 so node:test can
// cover them (the .tsx module cannot be imported).
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  composeSidebarBlock,
  shouldShowSidebarBlock,
} from "../src/sidebar-block.ts"
import type { SidebarBlockLine, SidebarBlockSources, SidebarBlockState } from "../src/sidebar-block.ts"

const newSidebarSources = (
  overrides: Partial<SidebarBlockSources> = {},
): SidebarBlockSources => ({
  now: () => 20_000,
  collapsed: () => false,
  running: () => false,
  started: () => undefined,
  last: () => undefined,
  exactRate: () => undefined,
  avgRate: () => undefined,
  liveTokensPerSecond: () => undefined,
  calibrationFactor: () => 1,
  liveMemory: new Map(),
  sessionID: "ses_sidebar",
  todayStats: () => undefined,
  hitScope: () => "today",
  totalScope: () => "today",
  scopeStats: () => undefined,
  sessionTokens: () => undefined,
  ...overrides,
})

test("composeSidebarBlock returns an empty line list when idle", () => {
  assert.deepEqual(composeSidebarBlock(newSidebarSources()), { collapsed: false, lines: [] })
})

test("composeSidebarBlock short-circuits while collapsed", () => {
  // The collapsed branch must not read the status/stats sources at all — a
  // throwing source proves the read never happens.
  const state = composeSidebarBlock(
    newSidebarSources({
      collapsed: () => true,
      running: () => {
        throw new Error("status read while collapsed")
      },
      todayStats: () => {
        throw new Error("stats read while collapsed")
      },
    }),
  )
  assert.deepEqual(state, { collapsed: true, lines: [] })
})

test("composeSidebarBlock picks exactly one of ⏱ / ⏳ / 🏁", () => {
  assert.deepEqual(
    composeSidebarBlock(newSidebarSources({ running: () => true, started: () => 8_000 })),
    { collapsed: false, lines: [{ text: "⏱ 12.0s", dim: false }] },
  )
  assert.deepEqual(composeSidebarBlock(newSidebarSources({ running: () => true })), {
    collapsed: false,
    lines: [{ text: "⏳", dim: false }],
  })
  assert.deepEqual(composeSidebarBlock(newSidebarSources({ last: () => 5_000 })), {
    collapsed: false,
    lines: [{ text: "🏁 5.0s", dim: false }],
  })
})

test("composeSidebarBlock settles the idle ⚡ from exact then avg", () => {
  assert.deepEqual(
    composeSidebarBlock(newSidebarSources({ last: () => 5_000, exactRate: () => 42 })),
    {
      collapsed: false,
      lines: [
        { text: "🏁 5.0s", dim: false },
        { text: "⚡ 42 tok/s", dim: false },
      ],
    },
  )
  assert.deepEqual(
    composeSidebarBlock(newSidebarSources({ last: () => 5_000, avgRate: () => 30 })),
    {
      collapsed: false,
      lines: [
        { text: "🏁 5.0s", dim: false },
        { text: "⚡ 30 tok/s avg", dim: false },
      ],
    },
  )
})

test("composeSidebarBlock floors a calibrated live rate at 1 (0.7.38 B2)", () => {
  const liveMemory = new Map()
  const state = composeSidebarBlock(
    newSidebarSources({
      running: () => true,
      started: () => 8_000,
      liveTokensPerSecond: () => 1,
      calibrationFactor: () => 0.25,
      liveMemory,
    }),
  )
  assert.deepEqual(state.lines, [
    { text: "⏱ 12.0s", dim: false },
    { text: "⚡ 1 tok/s", dim: false },
  ])
  assert.equal(liveMemory.get("ses_sidebar")?.tokensPerSecond, 1)
  assert.ok(!state.lines.some((line) => line.text.includes("0 tok/s")))
})

test("composeSidebarBlock marks a held-but-stale live rate dim", () => {
  const liveMemory = new Map([
    ["ses_sidebar", { turnStartedAt: 8_000, tokensPerSecond: 45 }],
  ])
  const state = composeSidebarBlock(
    newSidebarSources({ running: () => true, started: () => 8_000, liveMemory }),
  )
  assert.deepEqual(state.lines, [
    { text: "⏱ 12.0s", dim: false },
    { text: "⚡ 45 tok/s", dim: true },
  ])
})

test("composeSidebarBlock renders the 📊 scope line, with the cache-inclusive suffix", () => {
  const freshOnly = composeSidebarBlock(
    newSidebarSources({
      running: () => true,
      started: () => 8_000,
      totalScope: () => "7d",
      scopeStats: () => ({ tokens: { input: 1_000, output: 0, reasoning: 0 } }),
    }),
  )
  assert.deepEqual(freshOnly.lines, [
    { text: "⏱ 12.0s", dim: false },
    { text: "📊 1.0k (7d)", dim: false },
  ])
  const withCache = composeSidebarBlock(
    newSidebarSources({
      running: () => true,
      started: () => 8_000,
      scopeStats: () => ({
        tokens: { input: 1_000, output: 0, reasoning: 0, cache: { read: 500, write: 0 } },
      }),
    }),
  )
  assert.deepEqual(withCache.lines, [
    { text: "⏱ 12.0s", dim: false },
    { text: "📊 1.0k / 1.5k (today)", dim: false },
  ])
})

test("composeSidebarBlock renders the 🎯 hit line for each scope", () => {
  const session = composeSidebarBlock(
    newSidebarSources({
      running: () => true,
      started: () => 8_000,
      hitScope: () => "session",
      sessionTokens: () => ({ input: 5, cache: { read: 5, write: 0 } }),
    }),
  )
  assert.deepEqual(session.lines, [
    { text: "⏱ 12.0s", dim: false },
    { text: "🎯 50.0% (session)", dim: false },
  ])
  const daily = composeSidebarBlock(
    newSidebarSources({
      running: () => true,
      started: () => 8_000,
      hitScope: () => "today",
      todayStats: () => ({ tokens: { input: 50, cache: { read: 50 } } }),
    }),
  )
  assert.deepEqual(daily.lines, [
    { text: "⏱ 12.0s", dim: false },
    { text: "🎯 50.0% (today)", dim: false },
  ])
})

test("shouldShowSidebarBlock hides the block when the switch is off", () => {
  const state: SidebarBlockState = { collapsed: false, lines: [{ text: "⏱ 1s", dim: false }] }
  assert.equal(
    shouldShowSidebarBlock(
      () => false,
      () => state,
      () => {},
    ),
    false,
  )
})

test("shouldShowSidebarBlock treats a collapsed header as content", () => {
  assert.equal(
    shouldShowSidebarBlock(
      () => true,
      () => ({ collapsed: true, lines: [] }),
      () => {},
    ),
    true,
  )
})

test("shouldShowSidebarBlock (B1): reads the tick even while disabled so an off->on flip can recompute", () => {
  let tickReads = 0
  let enabled = false
  let lines: SidebarBlockLine[] = []
  const readTick = () => {
    tickReads += 1
  }
  const evaluate = (): boolean =>
    shouldShowSidebarBlock(() => enabled, () => ({ collapsed: false, lines }), readTick)

  // Off and empty: hidden, but the tick read still happened — Solid clears
  // the sources registered by the previous recompute on every run, so
  // skipping this read would drop the memo's now() dependency permanently.
  assert.equal(evaluate(), false)
  assert.equal(tickReads, 1)
  // A later tick while still off must also read the tick.
  assert.equal(evaluate(), false)
  assert.equal(tickReads, 2)
  // The switch flips on and content arrives on a later tick: now visible.
  enabled = true
  lines = [{ text: "⏱ 12s", dim: false }]
  assert.equal(evaluate(), true)
  assert.equal(tickReads, 3)
})
