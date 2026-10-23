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
import { fmtNum, format } from "../format"
import { dailyHitRatio, sessionHitRatio } from "../hit-rate"
import { liveRate } from "../rate-model"
import { coalesceFooterRuns } from "../footer-runs"
import type { FooterSegment } from "../footer-runs"
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
// TextAttributes.DIM from @opentui/core (SGR 2), inlined as a number: src/ may
// only import host-provided specifiers (@opentui/solid / solid-js /
// @opencode/*), and `@opentui/core` is not one of them — importing it breaks
// the delivery contract and, worse, the host's module resolution at load time
// (pitfall #16). The value is a stable part of the attribute bitmask
// (NONE 0, BOLD 1, DIM 2, ITALIC 4, UNDERLINE 8, …), read from the host's own
// types.js next to the package (DIM: 1 << 1). The `attributes` prop itself is
// a declared text option (TextOptions extends TextBufferOptions in
// @opentui/core/renderables), and the text setter forwards it to
// setDefaultAttributes + requestRender, so it re-paints on the tick.
const DIM_TEXT_ATTRIBUTE = 1 << 1

export function createFooterStatus(deps: {
  context: any
  sessionMetrics: SessionMetricsApi
  settings: SettingsApi
  statsSource: StatsSourceApi
  calibration: CalibrationApi
  now: () => number
}): FooterStatusApi {
  const { context, now } = deps
  const { starts, lastDurations, lastAvgRates, lastExactRates, rates, backfillLastTurn } =
    deps.sessionMetrics
  const { hitScopeEnabled, totalScopeEnabled, footerHitEnabled, footerSigmaEnabled } =
    deps.settings
  const { todayStats, totalFor } = deps.statsSource
  const { calibOf } = deps.calibration

  // v0.7.35: last LIVE rate per session. When liveRate() drops out (tool
  // run > 4s, or the model is thinking without text deltas) the footer used
  // to lose its ⚡ segment and the row visibly shrank. We now keep showing
  // the last number we actually had and dim it, so the row keeps its shape
  // and reads as "not moving right now". Deliberately NOT lastExactRates/
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
  const lastLiveRates = new Map<string, { turnStartedAt: number; tokensPerSecond: number }>()

  const FooterStatus = (componentProps: { slotProps?: any }) => {
    const slotProps = componentProps.slotProps
    // v0.7.26: router.current() is a host client call like status() (see the
    // 0.7.21 guard below) — a throwing stale handle would propagate through
    // the slot render stack and kill the footer slot until re-mount, so
    // degrade to undefined. The extraction mirrors stats-panel's superset
    // form (route.sessionID on session routes) so both surfaces survive the
    // same host route shape changes.
    let sessionID: string | undefined
    try {
      const route: any = context.ui?.router?.current?.()
      sessionID = slotProps?.sessionID
        ?? (route?.type === "session"
          ? (route.sessionID ?? route.params?.sessionID)
          : route?.params?.sessionID)
    } catch {}
    if (!sessionID) return null

    // v0.7.5: sessions opened after a TUI restart have no in-memory turn
    // history yet — replay the last turn from synced records once (guarded,
    // so repeated host re-mounts stay no-ops).
    backfillLastTurn(sessionID)

    // v0.7.8: every dynamic read (now(), session status, stats signals,
    // settings signals) lives inside the memo, so the interpolation below
    // re-renders on each 500ms tick and on every stats refresh. The Maps
    // (starts/lastDurations/rates) are plain mutable structures — the
    // always-read `now()` re-evaluates the memo every 500ms and picks up
    // their changes, matching the original "tick-driven" design.
    const statusText = createMemo(() => {
      const currentTime = now()
      // 0.7.21: the host client's status() can throw (e.g. after a server
      // restart the client handle can go bad). `?.` only guards a missing
      // method, not a throwing one — and a throw inside a memo now runs in
      // the same reactive instance as the reconciler's effects, so it would
      // poison the render chain. Degrade to "not running" instead.
      let running = false
      try {
        running = context.data?.session?.status?.(sessionID) === "running"
      } catch {}
      const started = starts.get(sessionID)
      const last = lastDurations.get(sessionID)

      const parts: FooterSegment[] = []
      if (running && started !== undefined) {
        // v0.7.3: icon-only state labels — ⏱ elapsed while waiting, ⏳ running
        // without a start timestamp, 🏁 last turn. No textual state words.
        parts.push({ text: `⏱ ${format(currentTime - started)}` })
        const rate = rates.get(sessionID)
        const tps = rate ? liveRate(rate, currentTime) : undefined
        if (tps !== undefined) {
          const tokensPerSecond = Math.round(tps * calibOf(sessionID))
          lastLiveRates.set(sessionID, { turnStartedAt: started, tokensPerSecond })
          parts.push({ text: `⚡ ${tokensPerSecond} tok/s` })
        } else {
          // v0.7.35: no live window right now — hold the last known number in
          // the same wording, dimmed, instead of dropping the segment and
          // reflowing the row. The turn stamp must match, so a fresh turn
          // never revives the previous turn's number; no memory at all (first
          // seconds of a turn, or after a restart) means there is nothing
          // honest to show, so the segment is omitted exactly as before.
          const memory = lastLiveRates.get(sessionID)
          if (memory !== undefined && memory.turnStartedAt === started) {
            parts.push({ text: `⚡ ${memory.tokensPerSecond} tok/s`, dim: true })
          }
        }
      } else if (running) {
        parts.push({ text: `⏳` })
      } else if (last !== undefined) {
        // v0.7.2: checkered flag replaces the "✓ last" wording (icon-only
        // labels, consistent with ⏱/⚡/📊/🎯).
        parts.push({ text: `🏁 ${format(last)}` })
        const exact = lastExactRates.get(sessionID)
        if (exact !== undefined) {
          parts.push({ text: `⚡ ${exact} tok/s` })
        } else {
          const avg = lastAvgRates.get(sessionID)
          if (avg !== undefined) parts.push({ text: `⚡ ${avg} tok/s avg` })
        }
      }
      // v0.7.0: Σ/hit footer segments are opt-in via /usage-settings (the
      // footer defaults to waited + tok/s only). The hit scope stays
      // configurable: "today" (all-session daily aggregate, read/(read+input))
      // or "session" (strict read/(input+read+write), shown as "hit·s").
      // Reads are reactive: toggling updates at once.
      // v0.7.7: the Σ segment follows the persisted total scope (today is the
      // silent default; rolling windows carry a range tag so the number can't
      // be misread as "today"). v0.7.12: segment order is now enforced in
      // both scope branches — Σ always precedes hit (the session branch
      // used to push hit·s first, drifting from the documented order).
      const totalScope = totalScopeEnabled()
      const scopeStats = totalFor(totalScope)
      if (footerSigmaEnabled() && scopeStats) {
        const scopeTokens = scopeStats?.tokens
        const scopeTotal =
          (scopeTokens?.input ?? 0) + (scopeTokens?.output ?? 0) + (scopeTokens?.reasoning ?? 0)
        if (scopeTotal > 0) {
          parts.push({
            text: `Σ ${fmtNum(scopeTotal)}${totalScope === "today" ? "" : ` (${totalScope})`}`,
          })
        }
      }
      const hitScope = hitScopeEnabled()
      const showHitInFooter = footerHitEnabled()
      if (showHitInFooter && hitScope === "session") {
        try {
          const sessionTokens = context.data?.session?.get?.(sessionID)?.tokens
          const sessionRatio = sessionHitRatio(
            sessionTokens?.cache?.read ?? 0,
            sessionTokens?.input ?? 0,
            sessionTokens?.cache?.write ?? 0,
          )
          // One decimal: the daily/session ratio is naturally stable, so an
          // integer percent looks frozen while the underlying counts move.
          if (sessionRatio !== undefined)
            parts.push({ text: `hit·s ${(sessionRatio * 100).toFixed(1)}%` })
        } catch {}
      }
      const stats = todayStats()
      if (stats) {
        const todayTokens = stats?.tokens
        if (showHitInFooter && hitScope !== "session") {
          const dailyRatio = dailyHitRatio(todayTokens?.cache?.read ?? 0, todayTokens?.input ?? 0)
          if (dailyRatio !== undefined) parts.push({ text: `hit ${(dailyRatio * 100).toFixed(1)}%` })
        }
      }
      return parts.length > 0 ? parts : null
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
