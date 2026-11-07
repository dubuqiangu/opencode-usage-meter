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
import { liveRate } from "../rate-model"
import { DIM_TEXT_ATTRIBUTE } from "../text-attributes"
import { composeSidebarBlock, shouldShowSidebarBlock } from "../sidebar-block"
import { isSessionRunning } from "../session-context"
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
  const {
    starts,
    lastDurations,
    lastAvgRates,
    lastExactRates,
    lastLiveRates,
    rates,
    backfillLastTurn,
  } = deps.sessionMetrics
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
    // v0.7.38: the branch selection moved to sidebar-block.ts (pure, unit
    // testable). The sources below preserve the exact read order and the
    // collapsed short-circuit: none of the stats/status reads run while the
    // block is collapsed.
    const blockState = createMemo(() =>
      composeSidebarBlock({
        now,
        collapsed: statsBlockCollapsed,
        running: () => isSessionRunning(context, sessionID),
        started: () => starts.get(sessionID),
        last: () => lastDurations.get(sessionID),
        exactRate: () => lastExactRates.get(sessionID),
        avgRate: () => lastAvgRates.get(sessionID),
        liveTokensPerSecond: (currentTime) => {
          const rate = rates.get(sessionID)
          return rate ? liveRate(rate, currentTime) : undefined
        },
        calibrationFactor: () => calibOf(sessionID),
        liveMemory: lastLiveRates,
        sessionID,
        todayStats,
        hitScope: hitScopeEnabled,
        totalScope: totalScopeEnabled,
        scopeStats: (scope) => totalFor(scope),
        sessionTokens: () => {
          try {
            return context.data?.session?.get?.(sessionID)?.tokens
          } catch {
            return undefined
          }
        },
      }),
    )
    // v0.7.36: the "nothing to show yet" gate used to be an early return in
    // the component body. createComponent runs the body inside untrack, so
    // that read never registered as a dependency — and because the body
    // returned null, no child thunk was left that could have subscribed
    // either. Every TUI start hits that window (the stats fetch resolves
    // after the sidebar's first render), and the block then stayed invisible
    // until the host happened to re-mount the sidebar.
    // The gate is now a boolean memo read from the child thunks below:
    // visibility becomes a tracked dependency, and because this memo only
    // changes when visibility actually flips, the 500ms tick adds no work.
    // v0.7.38 (B1): shouldShowSidebarBlock reads the tick UNCONDITIONALLY,
    // before the on/off early return — Solid clears the sources registered by
    // the previous recompute on every run, so the old early return dropped
    // the now() dependency and the off->on flip never recomputed the block
    // back to visible on a non-reactive host.
    const hasContent = createMemo(() =>
      shouldShowSidebarBlock(sidebarMetricsEnabled, blockState, now),
    )
    const base = (context.theme as any)?.text?.base
    const muted = context.theme?.text?.muted
    return (
      <box flexDirection="column">
        {() => {
          if (!hasContent()) return null
          return (
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
              {/* v0.7.9: full-width clickable header row — mouse-up toggles the
                  collapsed flag in the durable settings store. */}
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
          )
        }}
        {() => {
          if (!hasContent()) return null
          const state = blockState()
          if (state.collapsed) return null
          // One <text> per line: a single <text> carries one attribute set for
          // its whole content, so the dimmed stale ⚡ could not be expressed
          // inside the old newline-joined string. `attributes` gets NONE (0)
          // rather than undefined — the host stores props verbatim and an
          // undefined would pollute the text buffer's default attributes.
          return state.lines.map((line) => (
            <text fg={muted} attributes={line.dim ? DIM_TEXT_ATTRIBUTE : 0}>
              {line.text}
            </text>
          ))
        }}
      </box>
    )
  }

  return { SidebarMetrics }
}
