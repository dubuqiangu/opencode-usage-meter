/** @jsxImportSource @opentui/solid */
// Footer slot component: waited timer / live tok/s / last-turn readout in
// the prompt footer status row, plus the opt-in Σ and hit segments.
// Split from tui.tsx in v0.7.x — behavior unchanged (same segment order,
// formulas and reactive reads as the original slot render).
//
// v0.7.8 reactivity fix: the segments used to be computed in the component
// body, which Solid runs exactly once per mount. The footer only looked
// live because the host re-renders prompt.footer.status very frequently
// (input activity, cursor blink) — on a quiet host it would have frozen the
// same way the sidebar block did. All dynamic reads now happen inside a
// createMemo that the JSX interpolation reads, so the 500ms tick and the
// stats signals drive the re-render directly.
import { createMemo } from "solid-js"
import { liveRate } from "../rate-model"
import { DIM_TEXT_ATTRIBUTE } from "../text-attributes"
import { coalesceFooterRuns, composeFooterSegments } from "../footer-runs"
import { currentSessionID, isSessionRunning } from "../session-context"
import type { CalibrationApi } from "../calibration"
import type { SessionMetricsApi } from "../session-metrics"
import type { SettingsApi } from "../settings"
import type { StatsSourceApi } from "../stats-source"

export type FooterStatusApi = {
  FooterStatus: (componentProps: { slotProps?: any }) => any
}

// One colour-run of the footer row. The row used to be a single <text> with
// one fg, which meant a segment could only ever be one colour — so a
// segment that needed to look different had to vanish instead. Splitting the
// row into runs lets the stale tok/s keep its place and only change tone.

export function createFooterStatus(deps: {
  context: any
  sessionMetrics: SessionMetricsApi
  settings: SettingsApi
  statsSource: StatsSourceApi
  calibration: CalibrationApi
  now: () => number
}): FooterStatusApi {
  const { context, now } = deps
  const {
    starts,
    lastDurations,
    lastAvgRates,
    lastExactRates,
    lastLiveRates,
    rates,
    backfillLastTurn,
  } = deps.sessionMetrics
  const { hitScopeEnabled, totalScopeEnabled, footerHitEnabled, footerSigmaEnabled } =
    deps.settings
  const { todayStats, totalFor } = deps.statsSource
  const { calibOf } = deps.calibration

  // v0.7.35/0.7.37: last LIVE rate per session. The Map lives in
  // session-metrics so the right-sidebar block reads the same memory; the rule
  // itself is resolveLiveRateReading(). When liveRate() drops out (tool run
  // > 4s, or the model is thinking without text deltas) the footer used to
  // lose its ⚡ segment and the row visibly shrank. We now keep showing the
  // last number we actually had and dim it, so the row keeps its shape and
  // reads as "not moving right now". Deliberately NOT lastExactRates/
  // lastAvgRates: those are finished-turn values (they jump to the turn
  // average the moment a turn ends), while this is the number the row was
  // showing a moment ago — the one the user is watching.
  //
  // Keyed by session AND stamped with the turn's start time. The stamp is
  // what keeps this honest across a turn boundary: finishTurn() deletes the
  // RateState, so a new turn rebuilds it from empty, and without the stamp
  // the memory would surface the PREVIOUS turn's number dimmed for the first
  // seconds of the new turn (before its own window fills). Since `started`
  // is the current turn's start, a mismatched stamp simply reads as "no
  // memory". One entry per session for the plugin instance's lifetime —
  // the same bounded shape as sessionModels (session-count magnitude, no
  // host handles), recorded in known-issues.

  const FooterStatus = (componentProps: { slotProps?: any }) => {
    const slotProps = componentProps.slotProps
    // v0.7.26: router.current() is a host client call like status() (see the
    // 0.7.21 guard below) — a throwing stale handle would propagate through
    // the slot render stack and kill the footer slot until re-mount, so
    // degrade to undefined. The extraction mirrors stats-panel's superset
    // form (route.sessionID on session routes) so both surfaces survive the
    // same host route shape changes.
    // v0.7.38 (B3): the sessionID gate now lives INSIDE the tracked memo
    // below, not in this body. The body runs inside untrack
    // (createComponent), so the old `if (!sessionID) return null` froze the
    // row blank whenever the first frame had no session yet, and it left no
    // subscribable child node for the 500ms tick to recover. Re-deriving the
    // id in the memo keeps that node and lets a late slotProps/router answer
    // heal the row.
    let backfilledSessionID: string | undefined

    // v0.7.8: every dynamic read (now(), session status, stats signals,
    // settings signals) lives inside the memo, so the interpolation below
    // re-renders on each 500ms tick and on every stats refresh. The Maps
    // (starts/lastDurations/rates) are plain mutable structures — the
    // always-read `now()` re-evaluates the memo every 500ms and picks up
    // their changes, matching the original "tick-driven" design.
    const statusText = createMemo(() => {
      // B3: read the tick first — the memo must keep its 500ms dependency even
      // while it has no session to show, otherwise a later sessionID could
      // never recover the row.
      const currentTime = now()
      const sessionID = currentSessionID(context, slotProps)
      if (!sessionID) return null
      // v0.7.5: sessions opened after a TUI restart have no in-memory turn
      // history yet — replay the last turn from synced records once per
      // session (guarded, so repeated tick reads stay no-ops).
      if (backfilledSessionID !== sessionID) {
        backfilledSessionID = sessionID
        backfillLastTurn(sessionID)
      }
      const rate = rates.get(sessionID)
      const liveTokensPerSecond = rate ? liveRate(rate, currentTime) : undefined
      const totalScope = totalScopeEnabled()
      const scopeStats = totalFor(totalScope)
      return composeFooterSegments({
        now: currentTime,
        running: isSessionRunning(context, sessionID),
        started: starts.get(sessionID),
        last: lastDurations.get(sessionID),
        exactRate: lastExactRates.get(sessionID),
        avgRate: lastAvgRates.get(sessionID),
        liveTokensPerSecond,
        calibrationFactor: calibOf(sessionID),
        liveMemory: lastLiveRates,
        sessionID,
        footerSigmaEnabled: footerSigmaEnabled(),
        totalScope,
        scopeStats,
        footerHitEnabled: footerHitEnabled(),
        hitScope: hitScopeEnabled(),
        readSessionTokens: () => {
          try {
            return context.data?.session?.get?.(sessionID)?.tokens
          } catch {
            return undefined
          }
        },
        todayStats: todayStats(),
      })
    })
    // v0.7.36: the "nothing to show" gate lives in the child thunk below, not
    // here. This body runs inside untrack (createComponent), so an early
    // return would freeze the row at its mount-time emptiness and no later
    // signal could bring it back — exactly what happened when the footer
    // slot's first render landed before any turn existed. The mount box is
    // created by reactive-mount.ts either way, so returning an empty <box>
    // instead of null is layout-identical.
    const muted = context.theme?.text?.muted
    // v0.7.35: the row is no longer one <text>. A <text> carries a single fg
    // and a single attribute set for its whole content, so the stale ⚡
    // segment could not be toned down inside it — it had to disappear
    // instead, and the row reflowed. The row is now a horizontal box of
    // sibling <text> runs (one per tone, see the coalescing below), and the
    // customary three-space gap is carried by the run strings themselves so
    // the spacing is identical to the old single joined string.
    // "Dimmed" is the DIM text attribute (SGR 2, see DIM_TEXT_ATTRIBUTE) on
    // that one run — no opacity prop exists in this API, and a darker theme
    // colour is not available: muted is already the darkest text token the
    // footer gets, so colour alone could not express "this number is stale"
    // without inventing a non-theme colour.
    // v0.7.10: function child instead of an eagerly evaluated string —
    // insertExpression wraps it in a tracked render effect, so the 500ms
    // now() tick re-renders the segment even when the host itself never
    // re-invokes the footer slot render (previously the footer only
    // looked live thanks to the host's frequent input-driven re-renders).
    // The box stays a bare row on purpose: the footer root is a horizontal
    // context, and any width="100%" / column prop here would reshape it
    // (see the slot comment in tui.tsx).
    return (
      <box flexDirection="row">
        {() => {
          const segments = statusText()
          if (!segments) return null
          // Coalesce into colour runs (pure helper above): one <text> per
          // tone change rather than one node per segment plus a
          // whitespace-only node per separator.
          const runs = coalesceFooterRuns(segments)
          // `attributes` gets TextAttributes.NONE (0) rather than undefined on
          // the non-dim runs: the host applies props with a plain `node[name]
          // = value`, and the setter only skips when the incoming value
          // equals the stored number — an undefined would be stored as-is and
          // leave the text buffer with a non-numeric default attribute.
          return runs.map((run) => (
            <text fg={muted} attributes={run.dim ? DIM_TEXT_ATTRIBUTE : 0}>
              {run.text}
            </text>
          ))
        }}
      </box>
    )
  }

  return { FooterStatus }
}
