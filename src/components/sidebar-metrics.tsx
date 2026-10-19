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
// v0.7.30: repaint cadence is the 500ms tick alone. The tick in tui.tsx
// calls requestRender() on every fire, so a store mutation lands on screen
// within a tick. The 0.7.11 header-click shortcut (local signal + an extra
// renderer.requestRender()) was removed: the official sidebar plugins
// (packages/tui/src/feature-plugins/sidebar/*) never touch `context.renderer`
// — they rely on the reactive store plus the host's paint cycle.
import { createMemo } from "solid-js"
import { fmtNum, format } from "../format"
import { dailyHitRatio, sessionHitRatio } from "../hit-rate"
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
    // v0.7.30: single source of truth for the collapsed state is the
    // persisted settings store. `context.storage.store` returns a
    // solid-js/store `Store` (official contract: "Durable JSON state ...
    // stays live-synced across running TUI instances"), so reading
    // `statsBlockCollapsed()` inside the memo registers a dependency and the
    // host's mutation re-runs it — no local mirror and no time window are
    // needed to bridge the async write. The old `lastLocalFlipAt` 2s window
    // (0.7.11-0.7.29) shadowed another instance's flip for two seconds and
    // forced the click handler to duplicate the memo's resolution rule.

    // v0.7.8/0.7.9: every dynamic read (now(), session status, stats
    // signals, settings signals, collapsed flag) lives inside the memo, so
    // the interpolations below re-render on each 500ms tick, on every stats
    // refresh, and when the store mutation lands contained in that tick.
    const blockState = createMemo(() => {
      const currentTime = now()
      const collapsed = statsBlockCollapsed()
      let metricText: string | null = null
      if (!collapsed) {
        // 0.7.21: wrap the host status() read — see footer-status.tsx; a
        // throwing client must degrade to "not running", not poison the
        // unified-instance reactive chain.
        let running = false
        try {
          running = context.data?.session?.status?.(sessionID) === "running"
        } catch {}
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
          const freshTokensTotal =
            (scopeTokens?.input ?? 0) + (scopeTokens?.output ?? 0) + (scopeTokens?.reasoning ?? 0)
          // v0.7.15: dual reading — same scope, cache-inclusive grand total
          // (in+out+reasoning+cache R/W) shown after the fresh-compute Σ/📊
          // metric, so "total tokens" answers that sum cache.read can be
          // reconciled at a glance. Omitted when there is no cache volume.
          const cacheInclusiveTotal =
            freshTokensTotal + (scopeTokens?.cache?.read ?? 0) + (scopeTokens?.cache?.write ?? 0)
          if (freshTokensTotal > 0) {
            metricLines.push(
              cacheInclusiveTotal > freshTokensTotal
                ? `📊 ${fmtNum(freshTokensTotal)} / ${fmtNum(cacheInclusiveTotal)} (${totalScope})`
                : `📊 ${fmtNum(freshTokensTotal)} (${totalScope})`,
            )
          }
        }
        if (hitScope === "session") {
          try {
            const sessionTokens = context.data?.session?.get?.(sessionID)?.tokens
            const sessionRatio = sessionHitRatio(
              sessionTokens?.cache?.read ?? 0,
              sessionTokens?.input ?? 0,
              sessionTokens?.cache?.write ?? 0,
            )
            if (sessionRatio !== undefined)
              metricLines.push(`🎯 ${(sessionRatio * 100).toFixed(1)}% (session)`)
          } catch {}
        } else if (stats) {
          const dailyRatio = dailyHitRatio(stats?.tokens?.cache?.read ?? 0, stats?.tokens?.input ?? 0)
          if (dailyRatio !== undefined)
            metricLines.push(`🎯 ${(dailyRatio * 100).toFixed(1)}% (today)`)
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
            // v0.7.30: the displayed state IS the persisted store value, so
            // flipping it needs no reconciliation with a local mirror. The
            // store mutation re-runs the memo, and the 500ms tick requests a
            // repaint, so the caret and metrics follow within a tick.
            toggleSettingsFlag("statsBlockCollapsed", statsBlockCollapsed())
          }}
        >
          {/* v0.7.10: the label text opts out of text selection
              (TextRenderable is selectable by default), so a header click
              can never start a selection and the toggle semantics stay
              clean. */}
          {/* v0.7.16: function-child thunks, NOT eager interpolations.
              Under esbuild --jsx=automatic a JSX interpolation is evaluated
              once at component-call time — and createComponent runs the
              component body inside untrack, so blockState() reads never
              registered anywhere: the render tree froze at mount, and
              neither the click flip nor the 500ms tick ever reached the
              screen (the toggle only surfaced after a session switch
              re-mounted the slot). Function children ARE tracked:
              insertExpression builds a render effect around each thunk, so
              blockState() becomes a live dependency — the caret patches
              in place and the metrics subtree grows/shrinks on toggle,
              same pattern as footer-status.tsx. */}
          <text fg={base} selectable={false}>
            {() => {
              return `${blockState().collapsed ? "▸" : "▼"} Stats`
            }}
          </text>
        </box>
        {() => {
          return blockState().collapsed ? null : (
            <text fg={muted}>{() => blockState().metricText}</text>
          )
        }}
      </box>
    )
  }

  return { SidebarMetrics }
}
