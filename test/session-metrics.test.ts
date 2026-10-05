// Unit tests for src/session-metrics.ts — the per-session turn lifecycle:
// start/delta/step events, exact adoption, the anti-double-count lock and
// the authoritative idle-rate recompute at turn end.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createSessionMetrics, type SessionMetricsApi } from "../src/session-metrics.ts"

type RecordedCalibrationCall = string

const createCalibrationStub = () => {
  const calls: RecordedCalibrationCall[] = []
  return {
    calls,
    stub: {
      calibOf: () => 1,
      learnCalibration: (_sessionID: string, before: number, out: number) => {
        calls.push(`learn:${before}:${out}`)
      },
      rememberSessionModel: (_sessionID: string, model: unknown) => {
        const modelRef = model as { providerID: string; id: string }
        calls.push(`model:${modelRef.providerID}/${modelRef.id}`)
      },
      release: () => {},
    },
  }
}

const createMetricsHarness = (assistantMessages: unknown[] = []) => {
  const calibration = createCalibrationStub()
  const statsRefreshDelays: number[] = []
  const metrics: SessionMetricsApi = createSessionMetrics({
    context: {
      data: { session: { message: { list: () => assistantMessages } } },
    },
    calibration: calibration.stub,
    scheduleStatsRefresh: (delayMs?: number) => {
      statsRefreshDelays.push(delayMs ?? -1)
    },
  })
  return { metrics, calibration, statsRefreshDelays }
}

test("onExecutionStarted resets the turn state for that session", () => {
  const { metrics } = createMetricsHarness()
  metrics.onExecutionStarted({ sessionID: "ses_turn" })
  assert.ok(metrics.starts.has("ses_turn"))
  assert.ok(metrics.rates.has("ses_turn"))
  assert.equal(metrics.rateStateOf("ses_turn")?.sessionVocab, false)
})

test("onSessionDelta accumulates estimated tokens per message and arms the vocab lock", () => {
  const { metrics } = createMetricsHarness()
  metrics.onExecutionStarted({ sessionID: "ses_stream" })
  metrics.onSessionDelta({
    sessionID: "ses_stream",
    assistantMessageID: "msg_one",
    delta: "hello world",
  })
  const state = metrics.rateStateOf("ses_stream")
  assert.ok(state)
  assert.equal(state.msgs.get("msg_one")?.est, 3)
  assert.equal(state.sessionVocab, true)
})

test("onLegacyDelta is ignored once a session-family delta was seen", () => {
  const { metrics } = createMetricsHarness()
  metrics.onExecutionStarted({ sessionID: "ses_dual" })
  metrics.onSessionDelta({
    sessionID: "ses_dual",
    assistantMessageID: "msg_one",
    delta: "aaaa",
  })
  const beforeErase = metrics.rateStateOf("ses_dual")?.msgs.get("msg_one")?.est
  metrics.onLegacyDelta({ sessionID: "ses_dual", messageID: "msg_one", delta: "bbbb" })
  assert.equal(metrics.rateStateOf("ses_dual")?.msgs.get("msg_one")?.est, beforeErase)
})

test("onStepEnded adopts a larger exact reading and learns calibration", () => {
  const { metrics, calibration } = createMetricsHarness()
  metrics.onExecutionStarted({ sessionID: "ses_step" })
  metrics.onSessionDelta({
    sessionID: "ses_step",
    assistantMessageID: "msg_one",
    delta: "hi",
  })
  metrics.onStepEnded({
    sessionID: "ses_step",
    assistantMessageID: "msg_one",
    tokens: { output: 500 },
  })
  const state = metrics.rateStateOf("ses_step")
  assert.equal(state?.msgs.get("msg_one")?.exact, 500)
  assert.ok(calibration.calls.some((entry) => entry.startsWith("learn:")))
})

test("onStepStarted recovers the start timestamp when execution.started was missed", () => {
  const { metrics } = createMetricsHarness()
  metrics.onStepStarted({ sessionID: "ses_recover", started: 1_700_000_000_000 })
  assert.equal(metrics.starts.get("ses_recover"), 1_700_000_000_000)
  metrics.onStepStarted({ sessionID: "ses_recover", started: 1_700_000_050_000 })
  assert.equal(metrics.starts.get("ses_recover"), 1_700_000_000_000)
})

test("finishTurn settles the idle readout from authoritative message records", async () => {
  const turnStart = Date.now() - 5_000
  const { metrics, statsRefreshDelays } = createMetricsHarness([
    {
      type: "assistant",
      time: { created: turnStart + 1_000, completed: turnStart + 3_000 },
      tokens: { output: 100, reasoning: 0 },
    },
    {
      type: "user",
      time: { created: turnStart, completed: turnStart + 100 },
      tokens: {},
    },
  ])
  metrics.onExecutionStarted({ sessionID: "ses_finish" })
  metrics.starts.set("ses_finish", turnStart)
  metrics.onSessionDelta({
    sessionID: "ses_finish",
    assistantMessageID: "msg_one",
    delta: "hello world again",
  })
  metrics.finishTurn({ sessionID: "ses_finish" })
  // exact rate: 100 tokens over the 2s assistant-message generation span
  assert.equal(metrics.lastExactRates.get("ses_finish"), 50)
  assert.ok(metrics.lastDurations.get("ses_finish") !== undefined)
  assert.ok(!metrics.starts.has("ses_finish"))
  assert.ok(!metrics.rates.has("ses_finish"))
  assert.ok(statsRefreshDelays.length > 0)
})

test("onMessageUpdated records the exact per-message rate and the model", () => {
  const { metrics, calibration } = createMetricsHarness()
  metrics.onExecutionStarted({ sessionID: "ses_update" })
  metrics.onMessageUpdated({
    sessionID: "ses_update",
    info: {
      id: "msg_two",
      role: "assistant",
      model: { providerID: "prov", id: "model-x" },
      time: { created: Date.now() - 2_000, completed: Date.now() },
      tokens: { output: 120, reasoning: 0 },
    },
  })
  // ~60 tok/s over a 2s span; assert the range to stay clock-jitter safe
  const exactRate = metrics.lastExactRates.get("ses_update") as number
  assert.ok(exactRate >= 55 && exactRate <= 65, `unexpected rate ${exactRate}`)
  assert.ok(calibration.calls.includes("model:prov/model-x"))
})

test("handlers ignore events without a session id", () => {
  const { metrics } = createMetricsHarness()
  metrics.onExecutionStarted({})
  metrics.onSessionDelta({ delta: "text" })
  metrics.finishTurn({})
  assert.equal(metrics.starts.size, 0)
  assert.equal(metrics.rates.size, 0)
})

test("backfillLastTurn restores the idle readout for sessions opened after a TUI restart", () => {
  const userCreated = Date.now() - 60_000
  const { metrics } = createMetricsHarness([
    {
      type: "user",
      time: { created: userCreated, completed: userCreated + 100 },
      tokens: {},
    },
    {
      type: "assistant",
      time: { created: userCreated + 1_000, completed: userCreated + 3_000 },
      tokens: { output: 100, reasoning: 0 },
    },
  ])
  metrics.backfillLastTurn("ses_backfill")
  // 0.7.12: the turn spans first assistant created -> last completed
  // assistant completed (3_000 - 1_000), excluding the 1s queue wait
  // after the user message — same basis as the live settle.
  assert.equal(metrics.lastDurations.get("ses_backfill"), 2_000)
  assert.equal(metrics.lastExactRates.get("ses_backfill"), 50)
})

test("backfillLastTurn never overwrites values already tracked live", () => {
  const userCreated = Date.now() - 60_000
  const { metrics } = createMetricsHarness([
    {
      type: "user",
      time: { created: userCreated, completed: userCreated + 100 },
      tokens: {},
    },
    {
      type: "assistant",
      time: { created: userCreated + 1_000, completed: userCreated + 3_000 },
      tokens: { output: 100, reasoning: 0 },
    },
  ])
  metrics.lastDurations.set("ses_live", 42_000)
  metrics.lastExactRates.set("ses_live", 7)
  metrics.backfillLastTurn("ses_live")
  assert.equal(metrics.lastDurations.get("ses_live"), 42_000)
  assert.equal(metrics.lastExactRates.get("ses_live"), 7)
})

test("backfillLastTurn skips sessions with an active run", () => {
  const { metrics } = createMetricsHarness([
    {
      type: "user",
      time: { created: Date.now() - 60_000 },
      tokens: {},
    },
    {
      type: "assistant",
      time: { created: Date.now() - 59_000, completed: Date.now() - 57_000 },
      tokens: { output: 100, reasoning: 0 },
    },
  ])
  metrics.onExecutionStarted({ sessionID: "ses_active" })
  metrics.backfillLastTurn("ses_active")
  assert.equal(metrics.lastDurations.has("ses_active"), false)
})

test("backfillLastTurn skips sessions whose last user message has no completed reply", () => {
  // The last turn is still running elsewhere (another TUI / background
  // subagent) — showing the previous turn's numbers would lie.
  const { metrics } = createMetricsHarness([
    {
      type: "assistant",
      time: { created: Date.now() - 60_000, completed: Date.now() - 58_000 },
      tokens: { output: 100, reasoning: 0 },
    },
    {
      type: "user",
      time: { created: Date.now() - 5_000 },
      tokens: {},
    },
  ])
  metrics.backfillLastTurn("ses_pending")
  assert.equal(metrics.lastDurations.has("ses_pending"), false)
  assert.equal(metrics.lastExactRates.has("ses_pending"), false)
})

test("backfillLastTurn is a safe no-op for sessions without parseable records", () => {
  const { metrics } = createMetricsHarness([])
  metrics.backfillLastTurn("ses_empty")
  assert.equal(metrics.lastDurations.has("ses_empty"), false)
  assert.doesNotThrow(() => metrics.backfillLastTurn("ses_empty"))
})

test("backfillLastTurn measures the turn from the first assistant message, excluding queue wait (0.7.12)", () => {
  // Same basis as the live settle: the turn spans the FIRST assistant
  // message's created -> the LAST completed assistant's completed. The
  // queue wait between the user message and generation starting must not
  // inflate the backfilled 🏁 span.
  const userCreated = Date.now() - 60_000
  const { metrics } = createMetricsHarness([
    {
      type: "user",
      time: { created: userCreated, completed: userCreated + 100 },
      tokens: {},
    },
    {
      type: "assistant",
      time: { created: userCreated + 5_000, completed: userCreated + 7_000 },
      tokens: { output: 60, reasoning: 0 },
    },
    {
      type: "assistant",
      time: { created: userCreated + 7_500, completed: userCreated + 9_000 },
      tokens: { output: 40, reasoning: 0 },
    },
  ])
  metrics.backfillLastTurn("ses_queue_wait")
  // 9_000 - 5_000 = 4s, not 9_000 - 0: the 5s queue wait is excluded.
  assert.equal(metrics.lastDurations.get("ses_queue_wait"), 4_000)
  // The exact rate keeps its own per-message created->completed basis:
  // 100 tokens over (2s + 1.5s) = ~28.6 -> 29 tok/s.
  assert.equal(metrics.lastExactRates.get("ses_queue_wait"), 29)
})

test("backfillLastTurn negative-caches structurally unusable records, not transient ones (0.7.12)", () => {
  // The footer slot re-mounts on nearly every host activity; only a
  // session whose list is structurally unusable for replay (content but
  // no user anchor) must stop rescanning. Empty lists and mid-run
  // sessions stay retryable (see the handover test below).
  let listCallCount = 0
  const calibration = createCalibrationStub()
  const metrics: SessionMetricsApi = createSessionMetrics({
    context: {
      data: {
        session: {
          message: {
            list: () => {
              listCallCount += 1
              return [{ type: "assistant", time: { created: Date.now() - 60_000 }, tokens: {} }]
            },
          },
        },
      },
    },
    calibration: calibration.stub,
    scheduleStatsRefresh: () => {},
  })
  metrics.backfillLastTurn("ses_unusable_records")
  metrics.backfillLastTurn("ses_unusable_records")
  metrics.backfillLastTurn("ses_unusable_records")
  assert.equal(listCallCount, 1)
  assert.equal(metrics.lastDurations.has("ses_unusable_records"), false)
  assert.equal(metrics.lastExactRates.has("ses_unusable_records"), false)
})

test("backfillLastTurn keeps retrying mid-run sessions until the turn completes (0.7.5 handover, 0.7.12)", () => {
  // A session running in another window: the user message exists but the
  // assistant reply is not completed yet. Every mount rescans (in-memory
  // list, cheap); once the turn completes elsewhere the idle readout
  // appears on the next mount — the 0.7.5 handover scenario, which a
  // cache-everything negative cache would have permanently broken.
  let turnCompleted = false
  let listCallCount = 0
  const calibration = createCalibrationStub()
  const metrics: SessionMetricsApi = createSessionMetrics({
    context: {
      data: {
        session: {
          message: {
            list: () => {
              listCallCount += 1
              return turnCompleted
                ? [
                    { type: "user", time: { created: 10_000 }, tokens: {} },
                    {
                      type: "assistant",
                      time: { created: 11_000, completed: 12_000 },
                      tokens: { output: 100 },
                    },
                  ]
                : [{ type: "user", time: { created: 10_000 }, tokens: {} }]
            },
          },
        },
      },
    },
    calibration: calibration.stub,
    scheduleStatsRefresh: () => {},
  })
  metrics.backfillLastTurn("ses_running_elsewhere")
  metrics.backfillLastTurn("ses_running_elsewhere")
  assert.equal(listCallCount, 2) // transient — rescanned, not cached
  assert.equal(metrics.lastDurations.has("ses_running_elsewhere"), false)
  turnCompleted = true
  metrics.backfillLastTurn("ses_running_elsewhere")
  assert.equal(metrics.lastDurations.get("ses_running_elsewhere"), 1_000)
  // The successful path scans once more here and once more inside
  // exactRateFromRecords' record aggregation: 2 failed + 2 = 4.
  assert.equal(listCallCount, 4)
})
