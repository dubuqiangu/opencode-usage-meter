/** @jsxImportSource @opentui/solid */
// v0.7.0: right-sidebar metrics block. The right column (session title +
// Context + MCP + agents sections) is the host's sidebar and exposes the
// `sidebar.content` slot — the same channel the native Context/MCP
// feature-plugins claim. Our block lands below them and mirrors the
// footer's live session readout plus today's Σ and the hit metric whose
// dimension follows the /usage-settings hitScope.
// Split from tui.tsx in v0.7.x — behavior unchanged.
//
// v0.7.8 reactivity fix: the lines used to be computed in the component
// body, which Solid runs exactly once per mount. The 500ms `now` tick and
// the stats signals kept updating the data, but nothing re-read them —
// the block looked frozen until the host happened to re-mount the sidebar
// (typically switching sessions). All dynamic reads now happen inside a
// createMemo that the JSX interpolation reads, so every tick and every
// stats refresh re-renders directly, decoupled from host re-mounts.
//
// v0.7.9 collapsible header: the "Stats" title row is now clickable and
// toggles ▼/▸ like the native MCP / OMO-Slim section headers. Mechanism
// verified against OMO-Slim's shipped bundle, which attaches mouse
// handlers to a full-width header box through @opentui/solid's setProp —
// the same prop pipeline JSX uses, so <box onMouseUp={...}> lands on the
// core node identically. The collapsed state persists in the settings
// store (statsBlockCollapsed) and survives restarts.
//
// v0.7.11 real-time repaint: the host TUI paints on demand — a reactive
// tree update alone never refreshes the screen; someone must call
// renderer.requestRender(). The 500ms tick in tui.tsx requests a repaint
// on every fire, and the header click flips a local collapsed signal and
// requests one immediately, so ▼/▸ toggles instantly instead of waiting
// for a host-driven repaint (e.g. a session switch).
import { createMemo, createSignal } from "solid-js"
import { fmtNum, format } from "../format"
import { liveRate } from "../rate-model"
import type { CalibrationApi } from "../calibration"
import type { SessionMetricsApi } from "../session-metrics"
import type { SettingsApi } from "../settings"
import type { StatsSourceApi } from "../stats-source"

export type SidebarMetricsApi = {
  SidebarMetrics: (props: { sessionID: string }) => any
}

export function createSidebarMetrics(deps: {
  context: any
  sessionMetrics: SessionMetricsApi
  settings: SettingsApi
  statsSource: StatsSourceApi
  calibration: CalibrationApi
  now: () => number
}): SidebarMetricsApi {
  const { context, now } = deps
  const { starts, lastDurations, lastAvgRates, lastExactRates, rates, backfillLastTurn } =
    deps.sessionMetrics
  const {
    sidebarMetricsEnabled,
    statsBlockCollapsed,
    hitScopeEnabled,
    totalScopeEnabled,
    toggleSettingsFlag,
  } = deps.settings
  const { todayStats, totalFor } = deps.statsSource
  const { calibOf } = deps.calibration

  const SidebarMetrics = (props: { sessionID: string }) => {
    // Mount-time gate — same semantics as the pre-0.7.8 body check:
    // toggling the block off in /usage-settings removes it on the next
    // host re-mount of the sidebar.
    if (!sidebarMetricsEnabled()) return null
    const sessionID = props.sessionID
    // v0.7.5: sessions opened after a TUI restart have no in-memory turn
    // history yet — replay the last turn from synced records once (guarded,
    // so repeated host re-mounts stay no-ops).
    backfillLastTurn(sessionID)
    // v0.7.11: local mirror of the persisted collapsed flag. The click
    // flips this signal synchronously (instant memo re-run + repaint),
    // then persists through the settings store — the store write alone
    // may not be reactive, and the host only repaints on request anyway.
    // v0.7.12: the memo no longer trusts the local signal exclusively —
    // that made the "mirrors the persisted flag" claim hollow, since a
    // collapse flipped in another TUI instance never showed up here. The
    // memo re-reads the persisted reader and only defers to the local
    // flip for a 2s window after a click (lastLocalFlipAt), which absorbs
    // the store write's async landing without bouncing the header back;
    // afterwards the persisted value wins, so cross-instance sync recovers
    // within the next 500ms tick.
    const [isCollapsed, setIsCollapsed] = createSignal(statsBlockCollapsed())
    let lastLocalFlipAt = 0
    // v0.7.8/0.7.9: every dynamic read (now(), session status, stats
    // signals, settings signals, collapsed flag) lives inside the memo, so
    // the interpolations below re-render on each 500ms tick, on every stats
    // refresh, and on header clicks. `now()` is read unconditionally — even
    // while collapsed — so the 500ms tick keeps re-evaluating the memo and a
    // collapsed<->expanded flip is picked up within 500ms even if the host
    // storage store turns out not to be reactive.
    const blockState = createMemo(() => {
      const currentTime = now()
      // v0.7.12: the persisted reader wins outside the 2s local-flip window
      // (see the comment above the signal); inside it the synchronous local
      // signal hides the store write's async landing. Both clocks are within
      // 500ms of each other, so Date.now() vs the tick value is equivalent.
      const persistedCollapsed = statsBlockCollapsed()
      const collapsed = Date.now() - lastLocalFlipAt < 2_000 ? isCollapsed() : persistedCollapsed
      let metricText: string | null = null
      if (!collapsed) {
        const running = context.data?.session?.status?.(sessionID) === "running"
        const started = starts.get(sessionID)
        const last = lastDurations.get(sessionID)
        const metricLines: string[] = []
        // v0.7.1: narrow column — split time and rate onto separate lines,
        // English-only labels, and unify the scope suffix in parentheses.
        if (running && started !== undefined) {
          metricLines.push(`⏱ ${format(currentTime - started)}`)
          const rate = rates.get(sessionID)
          const liveTokPerSec = rate ? liveRate(rate, currentTime) : undefined
          if (liveTokPerSec !== undefined) {
            metricLines.push(`⚡ ${Math.round(liveTokPerSec * calibOf(sessionID))} tok/s`)
          }
        } else if (running) {
          metricLines.push("⏳")
        } else if (last !== undefined) {
          metricLines.push(`🏁 ${format(last)}`)
          const exact = lastExactRates.get(sessionID)
          const avgRate = lastAvgRates.get(sessionID)
          if (exact !== undefined) metricLines.push(`⚡ ${exact} tok/s`)
          else if (avgRate !== undefined) metricLines.push(`⚡ ${avgRate} tok/s avg`)
        }
        const stats = todayStats()
        const hitScope = hitScopeEnabled()
        // v0.7.7: the 📊 total follows the persisted scope — today is the
        // default; rolling windows (24h/7d/30d) are separate read-only
        // queries fetched by the stats source on demand.
        const totalScope = totalScopeEnabled()
        const scopeStats = totalFor(totalScope)
        if (scopeStats) {
          const scopeTokens = scopeStats?.tokens
          const total =
            (scopeTokens?.input ?? 0) + (scopeTokens?.output ?? 0) + (scopeTokens?.reasoning ?? 0)
          if (total > 0) metricLines.push(`📊 ${fmtNum(total)} (${totalScope})`)
        }
        if (hitScope === "session") {
          try {
            const sessionTokens = context.data?.session?.get?.(sessionID)?.tokens
            const cacheRead = sessionTokens?.cache?.read ?? 0
            const denominator =
              (sessionTokens?.input ?? 0) + cacheRead + (sessionTokens?.cache?.write ?? 0)
            if (denominator > 0)
              metricLines.push(`🎯 ${((cacheRead / denominator) * 100).toFixed(1)}% (session)`)
          } catch {}
        } else if (stats) {
          const cacheRead = stats?.tokens?.cache?.read ?? 0
          const denominator = cacheRead + (stats?.tokens?.input ?? 0)
          if (denominator > 0)
            metricLines.push(`🎯 ${((cacheRead / denominator) * 100).toFixed(1)}% (today)`)
        }
        metricText = metricLines.length > 0 ? metricLines.join("\n") : null
      }
      return { collapsed, metricText }
    })
    // Mount-time gate mirrors the pre-0.7.8 "no lines -> hide the whole
    // block" rule (a collapsed header is always worth showing); afterwards
    // the interpolations keep the caret and text live.
    const initialState = blockState()
    if (!initialState.collapsed && initialState.metricText === null) return null
    const base = (context.theme as any)?.text?.base
    const muted = context.theme?.text?.muted
    return (
      <box flexDirection="column">
        {/* v0.7.9: full-width clickable header row — mouse-up toggles the
            collapsed flag in the durable settings store. */}
        <box
          flexDirection="row"
          width="100%"
          onMouseUp={() => {
            const wasCollapsed = isCollapsed()
            setIsCollapsed(!wasCollapsed)
            // Open the 2s window where the local flip shadows the persisted
            // value (the store write below may land asynchronously).
            lastLocalFlipAt = Date.now()
            toggleSettingsFlag("statsBlockCollapsed", wasCollapsed)
            // Instant feedback: the signal flip re-runs the memo now, and
            // the explicit repaint request makes it visible immediately
            // instead of waiting for the next 500ms tick.
            try {
              context.renderer?.requestRender?.()
            } catch {}
          }}
        >
          {/* v0.7.10: the label text opts out of text selection
              (TextRenderable is selectable by default), so a header click
              can never start a selection and the toggle semantics stay
              clean. */}
          <text fg={base} selectable={false}>{`${blockState().collapsed ? "▸" : "▼"} Stats`}</text>
        </box>
        {blockState().collapsed ? null : <text fg={muted}>{blockState().metricText}</text>}
      </box>
    )
  }

  return { SidebarMetrics }
}
