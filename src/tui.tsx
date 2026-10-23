/** @jsxImportSource @opentui/solid */
// OpenCode V2 TUI plugin "usage-meter" — assembly root. Shows usage
// indicators in the prompt footer status row (waited timer, live tok/s,
// last-turn readout, opt-in Σ/hit segments), plus the /usage-full stats
// panel, the /usage-settings dialog, and the right-sidebar metrics block.
//
// Split in v0.7.x into focused modules (pure structural move, behavior
// unchanged — this file only wires factories, slots, commands, events
// and cleanup in the original order):
//   format.ts          — pure formatting / token-estimation helpers
//   rate-model.ts      — rate math types + pure functions + event accessors
//   calibration.ts     — live/persisted per-model rate calibration
//   settings.ts        — durable settings store + readers / toggles
//   stats-source.ts    — daily-usage stats fetch / refresh / midnight rollover
//   session-metrics.ts — per-session runtime state + event handlers
//   panel-content.ts   — panel text builders (window / session / detail)
//   components/stats-panel.tsx      — StatsBody / StatsPanel / /usage-full
//   components/settings-dialog.tsx  — /usage-settings dialog body
//   components/sidebar-metrics.tsx  — sidebar.content metrics block
//   components/footer-status.tsx    — prompt.footer.status component
//
// Token sources (current OpenCode emits the session.* event family):
//   session.text.delta / session.reasoning.delta / session.tool.input.delta
//     -> real-time streaming chunks { sessionID, assistantMessageID, ordinal, delta }
//   session.step.ended / session.step.failed -> exact tokens { tokens: { output, ... } }
//   message.part.delta / message.updated kept as legacy fallbacks (guarded).
import { Plugin } from "@opencode/plugin/tui"
// 0.7.24: bare "solid-js" — the host provides solid-js and @opentui/* to
// plugin TUI code as externalized modules (OMO-Slim ships with none in its
// stamp and imports bare specifiers). Declaring them as peerDependencies
// installed PARASITE copies into the stamp whose solid instances are never
// active during host slot renders — "No renderer found" (pitfall #13/#15).
import { createSignal } from "solid-js"
import { createCalibration } from "./calibration"
import { createSettings } from "./settings"
import { createStatsSource } from "./stats-source"
import { createSessionMetrics } from "./session-metrics"
import { createPanelContent, PANEL_NAME } from "./panel-content"
import { createStatsPanel } from "./components/stats-panel"
import { createSettingsDialog } from "./components/settings-dialog"
import { createSidebarMetrics } from "./components/sidebar-metrics"
import { createFooterStatus } from "./components/footer-status"
// 0.7.22: slot mounts that create their render effects inside the plugin's
// own module graph (see reactive-mount.ts — pitfall #13 verdict).
import { createReactiveSlotMount } from "./reactive-mount"

export default Plugin.define({
  id: "usage-meter",
  setup(context: any) {
    // Ticking clock drives the elapsed recompute while a run is active, and
    // detects the midnight rollover for the daily usage stats.
    const [now, setNow] = createSignal(Date.now())

    // Module factories. Creation order preserves the original storage-store
    // subscription order (calibration store first, then settings store).
    const calibration = createCalibration(context)
    const settings = createSettings(context)
    // v0.7.7: the stats source follows the persisted Σ/📊 total scope so the
    // rolling window (24h/7d/30d) stays fresh alongside today.
    const statsSource = createStatsSource(context, settings.totalScopeEnabled)
    const sessionMetrics = createSessionMetrics({
      context,
      calibration,
      scheduleStatsRefresh: statsSource.scheduleStatsRefresh,
    })
    const panelContent = createPanelContent({
      context,
      sessionMetrics,
      settings,
      statsSource,
      calibration,
      now,
    })
    const statsPanel = createStatsPanel({ context, panelContent })
    // v0.7.12: the dialog's `s` key triggers an immediate totals fetch after
    // cycling the scope — the rolling-window aggregate needs it before the
    // 60s tick would get around to it. v0.7.13: the dialog also gets the
    // now signal — its memo reads now() unconditionally so the body stays
    // live even on hosts whose settings store is not reactive.
    const settingsDialog = createSettingsDialog({
      context,
      settings,
      fetchTotals: statsSource.fetchTotals,
      now,
    })
    const sidebarMetrics = createSidebarMetrics({
      context,
      sessionMetrics,
      settings,
      statsSource,
      calibration,
      now,
    })
    const footerStatus = createFooterStatus({
      context,
      sessionMetrics,
      settings,
      statsSource,
      calibration,
      now,
    })
    // The debounced stats refresh also refreshes an open stats panel; the
    // panel-name check + ensureDetail live here next to the panel assembly
    // (stats-source guards the call with the same try/catch as before).
    statsSource.bindPanelRefresh(() => {
      const current = (context.ui as any)?.panel?.current?.()
      if (current === PANEL_NAME || current?.name === PANEL_NAME) void panelContent.ensureDetail()
    })

    const timer = setInterval(() => {
      // 0.7.17: full-body guard — an exception escaping here (e.g. a
      // now-observer throwing inside setNow's synchronous flush) would
      // silently skip requestRender and possibly kill the interval.
      try {
        setNow(Date.now())
        statsSource.checkMidnightRollover()
        // v0.7.11: the host TUI paints on demand — updating the renderable
        // tree alone never refreshes the screen. Request a repaint on every
        // tick so the footer ⏱ / sidebar block keep walking while idle, and
        // any stats or settings change becomes visible within 500ms even
        // when nothing else drives a host repaint (OMO-Slim requests one
        // after every snapshot update for the same reason).
        try {
          if (typeof context.renderer?.requestRender === "function") {
            context.renderer.requestRender()
          }
        } catch {}
      } catch {}
    }, 500)

    const subs: Array<() => void> = []
    const listen = (type: string, handler: (event: any) => void) => {
      try {
        subs.push(context.data.on(type, handler))
      } catch (error) {
        console.error(`[usage-meter] ${type} subscription failed:`, error)
      }
    }

    const { StatsPanel, runTokensCommand } = statsPanel
    const { SettingsBody } = settingsDialog
    const { SidebarMetrics } = sidebarMetrics
    const { FooterStatus } = footerStatus

    // 0.7.22-0.7.24: per-slot reactive mounts (reactive-mount.ts, the
    // OMO-Slim reactiveElement pattern): the slot render returns a core box
    // that the plugin itself inserted the component into, so the render
    // effects are not at the mercy of host-side insertion of function
    // children (pitfall #13). 0.7.24: with the host-provided solid graph
    // (peers removed), the insert effects and our memos are one graph.
    const panelMount = createReactiveSlotMount(true)
    const sidebarMount = createReactiveSlotMount(true)
    const footerMount = createReactiveSlotMount(false)

    // --- /usage-full stats view: sidebar panel (in-session) + dialog fallback ---
    let unregisterPanel: any
    try {
      unregisterPanel = context.ui.slot({
        append: "session.panel",
        // v0.7.12: the panel body (header clock, detail tables) froze at its
        // first paint until the render was wrapped reactively. The
        // non-matching render path also releases the panel's "f" fullscreen
        // keymap layer (see createStatsPanel).
        // v0.7.22: the wrap is now a plugin-graph reactive mount
        // (reactive-mount.ts) — host-side insertion of function children
        // produced a mount-time snapshot on the real machine.
        render: (panel: any) => {
          if (panel?.name !== PANEL_NAME) {
            statsPanel.disposeFullscreenLayer()
            return <box width="100%" flexDirection="column" />
          }
          return panelMount.swap(() => <StatsPanel panel={panel} />)
        },
      })
    } catch (error) {
      console.error("[usage-meter] session.panel slot failed:", error)
    }

    let unregisterSidebarSlot: any
    try {
      unregisterSidebarSlot = context.ui.slot({
        append: "sidebar.content",
        // v0.7.10/v0.7.16: function-child wrapping never made this block live
        // on the real machine — the host inserts those children with its own
        // @opentui/solid/solid-js graph, so the tracked effects never saw
        // our memos and the block stayed a mount-time snapshot (pitfall #13,
        // verdict 2026-10-12). v0.7.22+: the render returns a core box the
        // plugin itself inserted the component into (reactive-mount.ts), the
        // proven OMO-Slim reactiveElement pattern.
        render: (sidebarProps: any) => {
          if (!sidebarProps?.sessionID) return null
          return sidebarMount.swap(() => <SidebarMetrics sessionID={sidebarProps.sessionID} />)
        },
      })
    } catch (error) {
      console.error("[usage-meter] sidebar.content slot failed:", error)
    }

    // /usage-full + palette commands "用量统计" / "用量设置".
    // v0.6.4 runtime fix: a keymap layer must be created from a component
    // scope — calling it directly from setup() throws "Keymap.Provider is
    // missing" on the host, which silently killed the /usage-full command
    // in 0.6.x. Register from an `app` slot render instead (runs once inside
    // the component tree).
    let layerDispose: any
    // v0.7.36: retry bookkeeping — a single failed attempt must not kill the
    // layer for the whole session (0.6.4: the app slot's first render can
    // land before Keymap.Provider exists). Failures leave the handle
    // undefined and the next app render retries, throttled so a permanently
    // broken host cannot spam the log.
    let layerFailureAt = 0
    const LAYER_RETRY_INTERVAL_MS = 5_000
    let unregisterAppSlot: any
    try {
      unregisterAppSlot = context.ui.slot({
        append: "app",
        render: () => {
          const retryDue =
            layerDispose === undefined &&
            (layerFailureAt === 0 || Date.now() - layerFailureAt >= LAYER_RETRY_INTERVAL_MS)
          if (retryDue) {
            try {
              const created = (context.keymap as any)?.layer?.(() => ({
                mode: "global",
                commands: [
                  {
                    id: "usage-meter.usage",
                    title: "用量统计(面板开关)",
                    group: "usage-meter",
                    palette: true,
                    slash: { name: "usage-full" },
                    run: () => {
                      void runTokensCommand()
                    },
                  },
                  {
                    // v0.6.7: /usage-settings — extensible settings dialog
                    // (footer hit dimension today; more items later).
                    id: "usage-meter.settings",
                    title: "用量设置(footer 指标维度等)",
                    group: "usage-meter",
                    palette: true,
                    slash: { name: "usage-settings" },
                    run: () => {
                      try {
                        context.ui.dialog.set({ size: "large", centered: true })
                      } catch {}
                      try {
                        // v0.7.12: the previously empty onClose leaked the
                        // dialog's d/s/f/h/b keymap layer — release it when
                        // the dialog closes (idempotent, see
                        // createSettingsDialog).
                        context.ui.dialog.show(
                          () => <SettingsBody />,
                          () => settingsDialog.disposeKeymapLayer(),
                        )
                      } catch (error) {
                        console.error("[usage-meter] settings dialog failed:", error)
                      }
                    },
                  },
                  {
                    // Palette-only backup toggle: works even if the dialog's
                    // in-dialog keybind cannot register on some hosts.
                    id: "usage-meter.hit-scope",
                    title: "切换 hit 维度(今日汇总 ⇄ 当前会话)",
                    group: "usage-meter",
                    palette: true,
                    run: () => {
                      // v0.7.12: compute the next scope up front — reading
                      // the store after the toggle raced the async write
                      // and flipped the toast direction on some hosts.
                      const nextHitScope =
                        settings.hitScopeEnabled() === "session" ? "today" : "session"
                      settings.toggleHitScope()
                      try {
                        ;(context.ui as any)?.toast?.show?.({
                          title: "usage-meter",
                          message:
                            nextHitScope === "session"
                              ? "hit 维度:当前会话(hit·s,严格口径)"
                              : "hit 维度:今日汇总(hit,全 session)",
                        })
                      } catch {}
                    },
                  },
                ],
              }))
              if (created) {
                layerDispose = created
                layerFailureAt = 0
              } else {
                layerFailureAt = Date.now()
                console.error("[usage-meter] keymap layer unavailable (will retry)")
              }
            } catch (error) {
              layerFailureAt = Date.now()
              console.error("[usage-meter] keymap layer failed (will retry):", error)
            }
          }
          return null
        },
      })
    } catch (error) {
      console.error("[usage-meter] app slot failed:", error)
    }

    // --- Session lifecycle events (original registration order) ----------
    listen("session.execution.started", sessionMetrics.onExecutionStarted)
    listen("session.step.started", sessionMetrics.onStepStarted)
    listen("session.execution.succeeded", sessionMetrics.finishTurn)
    listen("session.execution.failed", sessionMetrics.finishTurn)
    listen("session.execution.interrupted", sessionMetrics.finishTurn)
    listen("session.text.delta", sessionMetrics.onSessionDelta)
    listen("session.reasoning.delta", sessionMetrics.onSessionDelta)
    listen("session.tool.input.delta", sessionMetrics.onSessionDelta)
    listen("session.step.ended", sessionMetrics.onStepEnded)
    listen("session.step.failed", sessionMetrics.onStepEnded)
    listen("message.part.delta", sessionMetrics.onLegacyDelta)
    listen("message.updated", sessionMetrics.onMessageUpdated)

    // Initial daily-usage load for the footer Σ.
    statsSource.fetchTotals()
    // v0.6.8: periodic refresh (60s) — background sessions (subagents,
    // headless runs) consume usage without firing this session's turn
    // events, so the daily footer stats could lag indefinitely while idle.
    // v0.7.7: covers the active rolling scope as well.
    const statsInterval = setInterval(() => statsSource.fetchTotals(), 60_000)

    // v0.7.12: the footer slot is registered like every other slot now —
    // a bare call used to be the one unprotected registration (and its
    // unregister the one unprotected teardown).
    // v0.7.22: the render returns a plugin-graph reactive mount's root box
    // (no layout props — the footer is a horizontal context and a
    // width="100%"/column box would impose the sidebar's vertical shape on
    // it). Host-side insertion of the function child built the render
    // effect in the host's module graph, where our memos can never
    // register — the root cause of the frozen footer (pitfall #13).
    let unregisterFooterSlot: any
    try {
      unregisterFooterSlot = context.ui.slot({
        append: "prompt.footer.status",
        render: (slotProps: any) => {
          return footerMount.swap(() => <FooterStatus slotProps={slotProps} />)
        },
      })
    } catch (error) {
      console.error("[usage-meter] prompt.footer.status slot failed:", error)
    }

    return () => {
      clearInterval(timer)
      clearInterval(statsInterval)
      statsSource.release()
      // v0.7.22: dispose any live slot mount's reactive graph (idempotent
      // when the host already remounted past it).
      footerMount.release()
      sidebarMount.release()
      panelMount.release()
      if (typeof unregisterFooterSlot === "function") {
        try {
          unregisterFooterSlot()
        } catch {}
      }
      if (typeof unregisterSidebarSlot === "function") {
        try {
          unregisterSidebarSlot()
        } catch {}
      }
      if (typeof unregisterAppSlot === "function") {
        try {
          unregisterAppSlot()
        } catch {}
      }
      if (typeof unregisterPanel === "function") {
        try {
          unregisterPanel()
        } catch {}
      }
      if (typeof layerDispose === "function") {
        try {
          layerDispose()
        } catch {}
      } else if (layerDispose && typeof layerDispose.dispose === "function") {
        try {
          layerDispose.dispose()
        } catch {}
      }
      // v0.7.12: release the dialog / panel keymap layers in case they are
      // still up at teardown (both are idempotent no-ops when already
      // disposed).
      statsPanel.disposeFullscreenLayer()
      settingsDialog.disposeKeymapLayer()
      subs.forEach((stop) => {
        try {
          stop()
        } catch {}
      })
      // v0.7.12: cancels pending 1.5s delayed rate recomputes (they
      // previously kept firing after teardown); aligned with the other
      // factory releases.
      sessionMetrics.release()
      calibration.release()
      settings.release()
    }
  },
})
