/** @jsxImportSource @opentui/solid */
// Stats view components: the shared reactive body (live session header +
// detail tables), the sidebar panel contribution with its "f" fullscreen
// keymap, and the /usage-full toggle command with its dialog fallback.
// Split from tui.tsx in v0.7.x — behavior unchanged.
import { createMemo } from "solid-js"
import { PANEL_NAME } from "../panel-content"
import type { PanelContentApi } from "../panel-content"

export type StatsPanelApi = {
  StatsBody: (props: { sessionID?: string }) => any
  StatsPanel: (props: { panel: any }) => any
  runTokensCommand: () => Promise<void>
  disposeFullscreenLayer: () => void
}

export function createStatsPanel(deps: { context: any; panelContent: PanelContentApi }): StatsPanelApi {
  const { context } = deps
  const { sessionLines, detail, detailLines, ensureDetail, setDetail } = deps.panelContent

  // Shared reactive body: live session section (when in a session) + the
  // detail tables. createMemo keeps the panel ticking with the 500ms clock
  // and refreshing on every signal update.
  const StatsBody = (props: { sessionID?: string }) => {
    const lines = createMemo(() => {
      const out = [...sessionLines(props.sessionID)]
      const st = detail()
      if (!st) {
        out.push("统计加载中…")
        return out
      }
      if (st.error) {
        out.push(`统计加载失败:${st.error}`)
        return out
      }
      out.push(...detailLines(st))
      return out
    })
    const base = (context.theme as any)?.text?.base
    // v0.7.12: function child — the panel slot render is wrapped the same
    // way (tui.tsx), and this interpolation must stay lazy too so the memo
    // re-render actually reaches the renderable tree; eagerly joined text
    // froze the panel at its first paint.
    return <text fg={base}>{() => lines().join("\n")}</text>
  }

  // /usage-full toggles the sidebar panel: open when closed, collapse when open.
  // Falls back to a plain dialog outside a session (panel.open -> false).
  const runTokensCommand = async (): Promise<void> => {
    const panelAPI = (context.ui as any)?.panel
    try {
      const current = panelAPI?.current?.()
      if (current === PANEL_NAME || current?.name === PANEL_NAME) {
        panelAPI?.close?.()
        return
      }
    } catch {}
    let opened: any = true
    try {
      opened = panelAPI?.open?.(PANEL_NAME)
    } catch {
      opened = false
    }
    // v0.7.12: `opened !== true` — a missing panel API used to return
    // undefined here, which slipped through the old `=== false` check as
    // "success" and silently killed the command on hosts without a sidebar
    // panel. Only an explicit true skips the fallback.
    if (opened !== true) {
      // Dialog fallback (no sidebar): still pass the current sessionID so
      // the live window/session/subagent blocks render when inside a session.
      const route: any = context.ui?.router?.current?.()
      const sid: string | undefined =
        route?.type === "session"
          ? (route.sessionID ?? route.params?.sessionID)
          : route?.params?.sessionID
      try {
        context.ui.dialog.set({ size: "large", centered: true })
      } catch {}
      setDetail(undefined)
      try {
        context.ui.dialog.show(() => <StatsBody sessionID={sid} />, () => {})
      } catch (error) {
        console.error("[usage-meter] stats dialog fallback failed:", error)
      }
    } else {
      // v0.7.12: clear the stale detail from a previous open so the panel
      // shows the loading state instead of the old tables until refetch.
      setDetail(undefined)
    }
    void ensureDetail()
  }

  // Sidebar panel contribution: the host owns sizing/focus/close (collapse
  // via escape or toggling /usage-full; "f" toggles fullscreen while focused).
  // v0.7.12: the "f" fullscreen layer's dispose used to be dropped, so every
  // panel mount stacked another layer for the rest of the session. The
  // layer is created once per panel presence (guarded) and released when
  // the panel slot stops naming our panel (tui.tsx render path) or at
  // plugin teardown via disposeFullscreenLayer.
  let fullscreenLayerDispose: any
  // v0.7.13: the layer's run closure must not capture the panel object
  // from the mount that created it — the host hands the slot a fresh
  // panel object on re-renders, and a stale closure would toggle
  // fullscreen on a dead one. Every StatsPanel invocation refreshes this.
  let currentFullscreenPanel: any
  const StatsPanel = (props: { panel: any }) => {
    currentFullscreenPanel = props.panel
    if (fullscreenLayerDispose === undefined) {
      try {
        fullscreenLayerDispose = (context.keymap as any)?.layer?.(() => ({
          commands: [
            {
              id: "usage-meter.stats.fullscreen",
              title: "统计面板全屏",
              bind: "f",
              run: () => {
                try {
                  currentFullscreenPanel?.toggleFullscreen?.()
                } catch {}
              },
            },
          ],
        }))
      } catch {
        fullscreenLayerDispose = null
      }
    }
    return <StatsBody sessionID={props.panel?.sessionID} />
  }

  const disposeFullscreenLayer = (): void => {
    if (typeof fullscreenLayerDispose === "function") {
      try {
        fullscreenLayerDispose()
      } catch {}
    } else if (fullscreenLayerDispose && typeof fullscreenLayerDispose.dispose === "function") {
      try {
        fullscreenLayerDispose.dispose()
      } catch {}
    }
    fullscreenLayerDispose = undefined
  }

  return { StatsBody, StatsPanel, runTokensCommand, disposeFullscreenLayer }
}
