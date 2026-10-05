/** @jsxImportSource @opentui/solid */
// v0.6.7: /usage-settings — extensible settings dialog (currently one
// item family: the footer hit dimension and footer/sidebar toggles).
// Reactive reads from the settings store mean the body re-renders the
// moment a value changes. Split from tui.tsx in v0.7.x — behavior unchanged.
import { createMemo } from "solid-js"
import type { SettingsApi, TotalScope } from "../settings"
import { TOTAL_SCOPE_LABELS } from "../settings"

export type SettingsDialogApi = {
  SettingsBody: () => any
  disposeKeymapLayer: () => void
}

export function createSettingsDialog(deps: {
  context: any
  settings: SettingsApi
  fetchTotals: () => void
}): SettingsDialogApi {
  const { context, fetchTotals } = deps
  const {
    hitScopeEnabled,
    totalScopeEnabled,
    footerSigmaEnabled,
    footerHitEnabled,
    sidebarMetricsEnabled,
    toggleSettingsFlag,
    toggleHitScope,
    cycleTotalScope,
  } = deps.settings

  // v0.7.12: the keymap layer's dispose used to be dropped — every dialog
  // open stacked another layer, leaking the d/s/f/h/b binds for the rest
  // of the session. The layer is created once per open (guarded) and
  // released through the dialog's onClose callback, which tui.tsx wires to
  // disposeKeymapLayer below.
  let keymapLayerDispose: any

  const SettingsBody = () => {
    // Keymap layers must be created from a component scope (see §12D).
    if (keymapLayerDispose === undefined) {
      try {
        keymapLayerDispose = (context.keymap as any)?.layer?.(() => ({
          commands: [
            {
              id: "usage-meter.settings.toggle-hit",
              title: "用量设置:切换 hit 维度",
              bind: "d",
              run: () => toggleHitScope(),
            },
            {
              id: "usage-meter.settings.cycle-total-scope",
              title: "用量设置:Σ/📊 总耗维度",
              bind: "s",
              run: () => {
                cycleTotalScope()
                // v0.7.12: the rolling-window aggregate needs a fetch the
                // moment the scope flips — before this, the 60s tick was
                // the only thing that eventually moved the number. tui.tsx
                // injects statsSource.fetchTotals here.
                try {
                  fetchTotals()
                } catch {}
              },
            },
            {
              id: "usage-meter.settings.toggle-footer-sigma",
              title: "用量设置:footer Σ 段开关",
              bind: "f",
              run: () => toggleSettingsFlag("footerSigma", footerSigmaEnabled()),
            },
            {
              id: "usage-meter.settings.toggle-footer-hit",
              title: "用量设置:footer hit 段开关",
              bind: "h",
              run: () => toggleSettingsFlag("footerHit", footerHitEnabled()),
            },
            {
              id: "usage-meter.settings.toggle-sidebar",
              title: "用量设置:右栏指标块开关",
              bind: "b",
              run: () => toggleSettingsFlag("sidebarMetrics", sidebarMetricsEnabled()),
            },
          ],
        }))
      } catch {
        keymapLayerDispose = null
      }
    }
    // v0.7.12: the line list is computed lazily inside a memo — the dialog
    // used to snapshot the settings once at open, so d/s/f/h/b changed the
    // store but the visible text never moved until the dialog was reopened.
    // The function-child interpolation below keeps the memo tracked, and
    // the 0.7.11 tick repaint makes each change visible on screen.
    const lines = createMemo(() => {
      const onOff = (enabled: boolean): string => (enabled ? "开" : "关")
      const hitScopeLabel =
        hitScopeEnabled() === "session"
          ? "当前会话(hit·s,严格口径 read ÷ (input+read+write))"
          : "今日汇总(hit,全 session 日级,read ÷ (read+input))"
      const totalScope = totalScopeEnabled() as TotalScope
      const totalScopeLabel = `${TOTAL_SCOPE_LABELS[totalScope]}(今日=本地零点起,其余为滚动窗口)`
      return [
        "用量设置",
        "──────────────────────────────",
        `hit 维度:${hitScopeLabel}`,
        `Σ/📊 总耗维度:${totalScopeLabel}`,
        `footer Σ 段:${onOff(footerSigmaEnabled())}`,
        `footer hit 段:${onOff(footerHitEnabled())}`,
        `右栏指标块:${onOff(sidebarMetricsEnabled())}`,
        "",
        "d hit 维度 · s Σ 维度 · f footer Σ · h footer hit · b 右栏块 · Esc 关闭",
        "(footer 默认只显示 ⏱ 与 ⚡,其余段按需开启;选择自动持久化)",
      ]
    })
    return (
      <text fg={(context.theme as any)?.text?.base}>{() => lines().join("\n")}</text>
    )
  }

  // Releases the dialog's keymap layer. Idempotent: the guard in
  // SettingsBody re-creates the layer on the next open once this resets
  // the handle. tui.tsx calls this from the dialog's onClose callback and
  // from the plugin cleanup (in case the dialog is open at teardown).
  const disposeKeymapLayer = (): void => {
    if (typeof keymapLayerDispose === "function") {
      try {
        keymapLayerDispose()
      } catch {}
    } else if (keymapLayerDispose && typeof keymapLayerDispose.dispose === "function") {
      try {
        keymapLayerDispose.dispose()
      } catch {}
    }
    keymapLayerDispose = undefined
  }

  return { SettingsBody, disposeKeymapLayer }
}
