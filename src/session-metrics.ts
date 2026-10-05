// Runtime per-session token-flow state and the session.* / message.*
// event handlers that feed it. Split from tui.tsx in v0.7.x — behavior
// unchanged; the handlers keep their original bodies and are registered
// by tui.tsx in the original listen() order.
import { estimateTokens } from "./format"
import { dataOf, msgTotal, pushSample, sessionIDOf, tsOf, turnTotal } from "./rate-model"
import type { RateState } from "./rate-model"
import type { CalibrationApi } from "./calibration"

export type SessionMetricsApi = {
  onExecutionStarted: (event: any) => void
  onStepStarted: (event: any) => void
  onSessionDelta: (event: any) => void
  onStepEnded: (event: any) => void
  onLegacyDelta: (event: any) => void
  onMessageUpdated: (event: any) => void
  finishTurn: (event: any) => void
  backfillLastTurn: (sessionID: string) => void
  release: () => void
  starts: Map<string, number>
  lastDurations: Map<string, number>
  lastAvgRates: Map<string, number>
  lastExactRates: Map<string, number>
  rates: Map<string, RateState>
  rateStateOf: (sessionID: string) => RateState | undefined
}

export function createSessionMetrics(deps: {
  context: any
  calibration: CalibrationApi
  scheduleStatsRefresh: (delayMs?: number) => void
}): SessionMetricsApi {
  const { context, calibration, scheduleStatsRefresh } = deps

  // Turn start times and last finished durations, keyed by session ID.
  const starts = new Map<string, number>()
  const lastDurations = new Map<string, number>()
  const lastAvgRates = new Map<string, number>()
  // v0.6.2: exact per-message generation rate (output+reasoning over the
  // message's own created→completed span) — replaces the heuristic idle avg.
  const lastExactRates = new Map<string, number>()

  // Token-flow tracking per session, active only during a run.
  const rates = new Map<string, RateState>()
  const newRateState = (sessionID: string): RateState =>
    ({ sessionID, msgs: new Map(), samples: [], sessionVocab: false })

  const rateStateOf = (sessionID: string): RateState | undefined => {
    if (!starts.has(sessionID)) return undefined // only track during a run
    let st = rates.get(sessionID)
    if (!st) {
      st = newRateState(sessionID)
      rates.set(sessionID, st)
    }
    return st
  }

  // Add estimated tokens from a streaming chunk for a message.
  const addEst = (st: RateState, messageID: string | undefined, delta: string): void => {
    if (!delta) return
    const key = messageID ?? "_anon"
    const m = st.msgs.get(key) ?? { est: 0, refEst: 0 }
    m.est += estimateTokens(delta)
    st.msgs.set(key, m)
    pushSample(st)
  }

  // Adopt an exact cumulative output reading; only trust it when it is at
  // least our running estimate (guards against per-step / partial numbers),
  // or when authoritative (message completed).
  const adoptExact = (
    st: RateState,
    messageID: string | undefined,
    out: number,
    force: boolean,
  ): void => {
    const key = messageID ?? "_anon"
    const m = st.msgs.get(key) ?? { est: 0, refEst: 0 }
    if (force || out > msgTotal(m)) {
      // v0.6.2/v0.6.3: learn the estimator's correction ratio and fold it
      // into the session calibration factor (persisted per model) — the
      // calibration module owns that logic now.
      calibration.learnCalibration(st.sessionID, msgTotal(m), out)
      m.exact = out
      m.refEst = m.est
      st.msgs.set(key, m)
    }
    pushSample(st)
  }

  // v0.6.5: exact idle rate from authoritative message records — sum
  // (output+reasoning) over the turn's assistant messages ÷ sum of their
  // created→completed spans. Same basis as the native turn stats; replaces
  // sole dependence on the message.updated event (real-machine reports
  // show that channel is unreliable, which made the footer fall back to
  // the whole-wall-clock "avg" and under-report tok/s).
  const exactRateFromRecords = (sessionID: string, startedMs: number): void => {
    try {
      const messages = context.data?.session?.message?.list?.(sessionID) ?? []
      let toks = 0
      let genMs = 0
      for (const m of messages) {
        if (m?.type !== "assistant") continue
        const created = tsOf(m?.time?.created)
        const completed = tsOf(m?.time?.completed)
        const out = (m?.tokens?.output ?? 0) + (m?.tokens?.reasoning ?? 0)
        if (created === undefined || completed === undefined || out <= 0) continue
        if (created < startedMs - 2_000) continue // message from a previous turn
        toks += out
        genMs += Math.max(0, completed - created)
      }
      if (toks > 0 && genMs >= 500) {
        lastExactRates.set(sessionID, Math.round(toks / (genMs / 1000)))
      }
    } catch {}
  }

  // v0.7.5: cold-start backfill. lastDurations/lastExactRates are in-memory
  // Maps, so a session that already finished turns under a previous TUI
  // instance (or before the plugin loaded) shows no idle readout until its
  // next completed turn. When a surface first renders such a session, replay
  // the last turn from the synced authoritative message records — the same
  // data source finishTurn's exact-rate recompute uses, no extra fetching.
  // Guards: never overwrite live-tracked values, never touch an active run,
  // and skip when the last user message has no completed reply after it
  // (that session is mid-run elsewhere — showing stale numbers would lie).
  // v0.7.12: negative cache — the footer slot re-mounts on nearly every
  // host activity (input, cursor blink), and each mount used to re-run a
  // full message.list scan for sessions that cannot backfill. To bound
  // that cost without breaking the v0.7.5 handover scenario (take over a
  // session running elsewhere; 🏁 appears once its turn completes), only
  // STRUCTURALLY unusable records are cached: a non-empty list with no
  // user anchor at all. Transient states — an empty (unsynced) list, or a
  // last turn still queued/generating elsewhere — stay retryable so the
  // readout recovers on a later mount after the turn completes. Residual
  // (cheap rescans while unsynced/mid-run) recorded in known-issues.md.
  const backfillAttemptedSessions = new Set<string>()
  const backfillLastTurn = (sessionID: string): void => {
    if (
      !sessionID ||
      lastDurations.has(sessionID) ||
      starts.has(sessionID) ||
      backfillAttemptedSessions.has(sessionID)
    ) {
      return
    }
    try {
      const messages = context.data?.session?.message?.list?.(sessionID) ?? []
      let lastUserCreated: number | undefined
      let lastAssistantCompleted: number | undefined
      for (const message of messages) {
        if (message?.type === "user") {
          const created = tsOf(message?.time?.created)
          if (created !== undefined && (lastUserCreated === undefined || created > lastUserCreated)) {
            lastUserCreated = created
          }
        } else if (message?.type === "assistant") {
          const completed = tsOf(message?.time?.completed)
          if (
            completed !== undefined &&
            (lastAssistantCompleted === undefined || completed > lastAssistantCompleted)
          ) {
            lastAssistantCompleted = completed
          }
        }
      }
      if (lastUserCreated === undefined) {
        // No user anchor at all in a non-empty list: structurally unusable
        // for replay — negative-cache. An EMPTY list is just unsynced and
        // must stay retryable (records may arrive on a later mount).
        if (messages.length > 0) backfillAttemptedSessions.add(sessionID)
        return
      }
      if (lastAssistantCompleted === undefined || lastAssistantCompleted <= lastUserCreated) {
        // The last turn is still queued/generating elsewhere (or the list
        // is not synced yet) — transient, keep retryable so the v0.7.5
        // handover scenario (take over a session running elsewhere; 🏁
        // appears after its turn completes) still recovers.
        return
      }
      // v0.7.12: same basis as the exact-rate settle — the turn spans from
      // the FIRST assistant message's created to the LAST completed
      // assistant's completed, excluding the queue wait between the user
      // sending the message and the run actually generating. (Previously
      // user-created → completed, which overstated short turns whenever the
      // model sat in queue.) The 2s tolerance mirrors exactRateFromRecords'
      // previous-turn filter.
      let firstAssistantCreated: number | undefined
      for (const message of messages) {
        if (message?.type !== "assistant") continue
        const created = tsOf(message?.time?.created)
        if (created === undefined || created < lastUserCreated - 2_000) continue
        if (firstAssistantCreated === undefined || created < firstAssistantCreated) {
          firstAssistantCreated = created
        }
      }
      // Defensive fallback: no in-window assistant carries a parseable
      // created timestamp — keep the pre-0.7.12 user→completed span so the
      // readout still appears instead of silently vanishing.
      lastDurations.set(
        sessionID,
        lastAssistantCompleted - (firstAssistantCreated ?? lastUserCreated),
      )
      exactRateFromRecords(sessionID, lastUserCreated)
    } catch {}
  }

  const onExecutionStarted = (event: any): void => {
    const sessionID = sessionIDOf(event)
    if (!sessionID) return
    starts.set(sessionID, Date.now())
    rates.set(sessionID, newRateState(sessionID))
  }

  const onStepStarted = (event: any): void => {
    // Recovery if the execution.started event was missed (e.g. TUI opened mid-run).
    const sessionID = sessionIDOf(event)
    const data = dataOf(event)
    const started = data?.started
    if (sessionID && typeof started === "number" && !starts.has(sessionID)) {
      starts.set(sessionID, started)
      rates.set(sessionID, newRateState(sessionID))
    }
  }

  // v0.7.12: pending delayed recomputes are tracked so release() can cancel
  // them — they previously kept firing (and touching host state) after the
  // plugin instance was torn down by a reload.
  const delayedRecomputeTimers: ReturnType<typeof setTimeout>[] = []

  const finishTurn = (event: any): void => {
    const sessionID = sessionIDOf(event)
    if (!sessionID) return
    const started = starts.get(sessionID)
    if (started !== undefined) {
      const elapsed = Date.now() - started
      lastDurations.set(sessionID, elapsed)
      const st = rates.get(sessionID)
      const total = st ? turnTotal(st) : 0
      if (total > 0 && elapsed > 0) {
        lastAvgRates.set(sessionID, Math.round(total / (elapsed / 1000)))
      }
      exactRateFromRecords(sessionID, started)
      // The message record may not be synced yet when execution.succeeded
      // fires; one delayed recompute catches it (idempotent).
      const delayedRecompute = setTimeout(() => {
        const timerIndex = delayedRecomputeTimers.indexOf(delayedRecompute)
        if (timerIndex >= 0) delayedRecomputeTimers.splice(timerIndex, 1)
        try {
          exactRateFromRecords(sessionID, started)
        } catch {}
      }, 1_500)
      delayedRecomputeTimers.push(delayedRecompute)
    }
    starts.delete(sessionID)
    rates.delete(sessionID)
    scheduleStatsRefresh()
  }

  // --- Live streaming chunks (current V2 event family) ---
  const onSessionDelta = (event: any): void => {
    const data = dataOf(event)
    const sessionID = typeof data?.sessionID === "string" ? data.sessionID : undefined
    const delta = typeof data?.delta === "string" ? data.delta : undefined
    if (!sessionID || !delta) return
    const st = rateStateOf(sessionID)
    if (!st) return
    st.sessionVocab = true
    addEst(st, data.assistantMessageID ?? data.messageID, delta)
  }

  // --- Exact cumulative tokens when a step completes ---
  const onStepEnded = (event: any): void => {
    const data = dataOf(event)
    const sessionID = typeof data?.sessionID === "string" ? data.sessionID : undefined
    const out = data?.tokens?.output
    if (sessionID && typeof out === "number" && out > 0) {
      const st = rateStateOf(sessionID)
      if (st) {
        st.sessionVocab = true
        adoptExact(st, data.assistantMessageID ?? data.messageID, out, false)
      }
    }
    // Exact per-step usage means the server-side daily aggregate moved too.
    scheduleStatsRefresh()
  }

  // --- Legacy event family fallbacks ---
  // message.part.delta: only counted when no session.* delta was seen this
  // turn, so the same chunk is never counted twice.
  const onLegacyDelta = (event: any): void => {
    const data = dataOf(event)
    const sessionID = typeof data?.sessionID === "string" ? data.sessionID : undefined
    const delta = typeof data?.delta === "string" ? data.delta : undefined
    if (!sessionID || !delta) return
    const st = rateStateOf(sessionID)
    if (!st || st.sessionVocab) return
    addEst(st, data.assistantMessageID ?? data.messageID, delta)
  }

  const onMessageUpdated = (event: any): void => {
    const data = dataOf(event)
    const info = data?.info
    if (info?.role !== "assistant" || typeof info?.tokens?.output !== "number") return
    const sessionID = typeof data?.sessionID === "string" ? data.sessionID : undefined
    if (!sessionID) return
    // v0.6.3: remember the session's model to key persisted calibration.
    if (info.model) calibration.rememberSessionModel(sessionID, info.model)
    // v0.6.2: exact generation rate once the message completes —
    // (output + reasoning) / (completed - created), the same basis the
    // native per-message statistics use. v0.6.5: tolerant timestamp
    // coercion; the authoritative recompute at turn end (finishTurn)
    // no longer depends on this event firing.
    const t = info.time
    const created = tsOf(t?.created)
    const completed = tsOf(t?.completed)
    if (created !== undefined && completed !== undefined) {
      const dur = (completed - created) / 1000
      const toks = (info.tokens.output ?? 0) + (info.tokens.reasoning ?? 0)
      if (dur >= 0.5 && toks > 0) lastExactRates.set(sessionID, Math.round(toks / dur))
    }
    const st = rateStateOf(sessionID)
    if (!st) return
    const out = info.tokens.output
    if (out > 0) adoptExact(st, info.id, out, info.time?.completed !== undefined)
  }

  // v0.7.12: cancels every pending 1.5s delayed recompute — the timers are
  // the only resource this factory owns; the Maps and the negative cache die
  // with the plugin instance (no host handles held). tui.tsx calls this in
  // the plugin cleanup alongside the other factory releases.
  const release = (): void => {
    for (const pendingTimer of delayedRecomputeTimers) clearTimeout(pendingTimer)
    delayedRecomputeTimers.length = 0
  }

  return {
    onExecutionStarted,
    onStepStarted,
    onSessionDelta,
    onStepEnded,
    onLegacyDelta,
    onMessageUpdated,
    finishTurn,
    backfillLastTurn,
    release,
    starts,
    lastDurations,
    lastAvgRates,
    lastExactRates,
    rates,
    rateStateOf,
  }
}
