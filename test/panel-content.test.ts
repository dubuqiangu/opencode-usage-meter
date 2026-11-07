// Unit tests for src/panel-content.ts — the /usage-full detail fetch
// (ensureDetail): the happy path (windowed + all-time call pair, footer Σ
// kept in sync) and the v0.7.26 timeout degradation. The display builders
// (detailLines/sessionUsageLines/descendantSessions) are pure context-
// injected builders and remain a recorded coverage gap.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createPanelContent } from "../src/panel-content.ts"
import { createStatsSource } from "../src/stats-source.ts"

const newPanelContentHarness = (clientStats: (input: any) => Promise<any>) => {
  const statsSource = createStatsSource({ client: { session: { stats: clientStats } } })
  const panelContent = createPanelContent({
    context: {},
    sessionMetrics: {
      starts: new Map(),
      lastDurations: new Map(),
      lastAvgRates: new Map(),
      lastExactRates: new Map(),
      rates: new Map(),
    },
    settings: { totalScopeEnabled: () => "today" },
    statsSource,
    calibration: { calibOf: () => 1 },
    now: () => 1_000_000,
  })
  return { statsSource, panelContent }
}

test("ensureDetail fetches the windowed and all-time detail in one pass", async () => {
  const capturedInputs: any[] = []
  const { statsSource, panelContent } = newPanelContentHarness(async (input: any) => {
    capturedInputs.push(input)
    return { data: { tokens: { input: 1, output: 2, reasoning: 0 } } }
  })
  await panelContent.ensureDetail()
  const detail = panelContent.detail()
  assert.ok(detail?.today?.tokens, "today table fetched")
  assert.ok(detail?.all?.tokens, "all-time table fetched")
  assert.ok(statsSource.todayStats()?.tokens, "footer Σ stays in sync")
  assert.equal(capturedInputs.length, 2)
  assert.ok(
    capturedInputs.some((input) => typeof input.from === "number"),
    "windowed call present",
  )
  assert.ok(
    capturedInputs.some((input) => input.from === undefined),
    "all-time call present",
  )
})

test("ensureDetail degrades to the error state when the stats call never settles", async (t) => {
  // v0.7.26: both detail fetches race against the 15s stats timeout
  // (withFetchTimeout) — before this, a never-settling host call left the
  // panel on the loading state until the next 60s tick re-fired and stacked
  // another Promise.all on the dead one.
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const { panelContent } = newPanelContentHarness(() => new Promise(() => {}))
  const pendingDetail = panelContent.ensureDetail()
  await t.mock.timers.tick(15_000)
  await new Promise<void>((resolve) => setImmediate(resolve))
  await pendingDetail
  assert.match(String(panelContent.detail()?.error), /timed out/)
})

// Build a panel whose host session list is the supplied session records; the
// detail path is never exercised here, so the stats client is a plain stub.
const newPanelContentWithSessions = (sessions: any[]) =>
  createPanelContent({
    context: { data: { session: { list: () => sessions } } },
    sessionMetrics: {
      starts: new Map(),
      lastDurations: new Map(),
      lastAvgRates: new Map(),
      lastExactRates: new Map(),
      rates: new Map(),
    },
    settings: { totalScopeEnabled: () => "today" },
    statsSource: createStatsSource({ client: { session: { stats: async () => ({}) } } }),
    calibration: { calibOf: () => 1 },
    now: () => 1_000_000,
  })

test("descendantSessions caps a single wide generation at 200 (0.7.38 B4)", () => {
  // One root with 500 direct children: the outer while only checked the cap
  // before each dequeue, so the whole generation was pushed and `found`
  // returned 500. The inner break must hold the cap at exactly 200.
  const wideChildren = Array.from({ length: 500 }, (_, index) => ({
    id: `ses_child_${index}`,
    parentID: "ses_root",
  }))
  const panelContent = newPanelContentWithSessions(wideChildren)
  assert.equal(panelContent.descendantSessions("ses_root").length, 200)
})

test("descendantSessions walks the delegation tree breadth-first", () => {
  const sessions = [
    { id: "ses_root" },
    { id: "ses_a", parentID: "ses_root" },
    { id: "ses_c", parentID: "ses_root" },
    { id: "ses_b", parentID: "ses_a" },
    { id: "ses_unrelated", parentID: "ses_other" },
  ]
  const panelContent = newPanelContentWithSessions(sessions)
  const descendants = panelContent.descendantSessions("ses_root")
  assert.deepEqual(
    descendants.map((session) => session.id),
    ["ses_a", "ses_c", "ses_b"],
  )
})
