// Unit tests for src/panel-session-lines.ts — the /usage-full panel header's
// session readout (⏱/⏳/🏁 + live ⚡ + Σ), lifted out of panel-content.ts in
// v0.7.39. Covers the three state branches, the Σ line, and the B2 regression
// (a positive live reading must never render as "⚡ 0 tok/s").
import { test } from "node:test"
import assert from "node:assert/strict"
import { composePanelSessionLines, type PanelSessionLineSources } from "../src/panel-session-lines.ts"

const newPanelSessionSources = (
  overrides: Partial<PanelSessionLineSources> = {},
): PanelSessionLineSources => ({
  sessionID: "ses_panel",
  running: false,
  started: undefined,
  last: undefined,
  now: 1_000_000,
  liveTokensPerSecond: undefined,
  calibrationFactor: 1,
  exactRate: undefined,
  avgRate: undefined,
  totalScope: "today",
  scopeStats: undefined,
  ...overrides,
})

test("composePanelSessionLines returns no lines without a session id", () => {
  assert.deepEqual(composePanelSessionLines(newPanelSessionSources({ sessionID: undefined })), [])
})

test("composePanelSessionLines renders the running ⏱ + live ⚡ line", () => {
  assert.deepEqual(
    composePanelSessionLines(
      newPanelSessionSources({ running: true, started: 988_000, liveTokensPerSecond: 42 }),
    ),
    ["── 当前会话 ──", "  ⏱ 12.0s   ⚡ 42 tok/s"],
  )
})

test("composePanelSessionLines omits ⚡ while running with no live reading", () => {
  assert.deepEqual(
    composePanelSessionLines(newPanelSessionSources({ running: true, started: 988_000 })),
    ["── 当前会话 ──", "  ⏱ 12.0s"],
  )
})

test("composePanelSessionLines renders the ⏳ state when the start time is unknown", () => {
  assert.deepEqual(
    composePanelSessionLines(newPanelSessionSources({ running: true, started: undefined })),
    ["── 当前会话 ──", "  ⏳"],
  )
})

test("composePanelSessionLines settles the idle 🏁 from exact then avg", () => {
  assert.deepEqual(
    composePanelSessionLines(newPanelSessionSources({ last: 5_000, exactRate: 50 })),
    ["── 当前会话 ──", "  🏁 5.0s   ⚡ 50 tok/s"],
  )
  assert.deepEqual(
    composePanelSessionLines(newPanelSessionSources({ last: 5_000, avgRate: 30 })),
    ["── 当前会话 ──", "  🏁 5.0s   ⚡ 30 tok/s avg"],
  )
})

test("composePanelSessionLines renders the (空闲) empty state", () => {
  assert.deepEqual(composePanelSessionLines(newPanelSessionSources()), [
    "── 当前会话 ──",
    "  (空闲)",
  ])
})

test("composePanelSessionLines appends the Σ line for the persisted scope", () => {
  assert.deepEqual(
    composePanelSessionLines(
      newPanelSessionSources({
        totalScope: "7d",
        scopeStats: { tokens: { input: 1_000, output: 0, reasoning: 0 } },
      }),
    ),
    ["── 当前会话 ──", "  (空闲)", "  Σ 近7日 1.0k"],
  )
})

test("composePanelSessionLines floors a calibrated live reading at 1 (0.7.39 B2 completion)", () => {
  const lines = composePanelSessionLines(
    newPanelSessionSources({
      running: true,
      started: 988_000,
      liveTokensPerSecond: 1,
      calibrationFactor: 0.25,
    }),
  )
  assert.deepEqual(lines, ["── 当前会话 ──", "  ⏱ 12.0s   ⚡ 1 tok/s"])
  assert.ok(!lines.some((line) => line.includes("0 tok/s")))
})
