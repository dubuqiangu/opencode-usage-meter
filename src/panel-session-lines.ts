// Panel header session readout (⏱/⏳/🏁 + live ⚡ + Σ), lifted out of
// panel-content.ts in v0.7.39 so it is plain, renderer-free and unit-testable
// — the same split as footer-runs.ts / sidebar-block.ts (those .tsx modules
// hold JSX and cannot be imported by the Node test runner).
//
// Line order, the three-space separators, the (空闲) empty state and the Σ
// formula are preserved exactly from the former inline builder.
//
// v0.7.39 (B2 completion): the live ⚡ now goes through liveRateDisplayValue() —
// the rule the footer and sidebar already share. Before this the panel applied
// its own `Math.round(tps * calibrationFactor)`, the only such path left in the
// repo, so the estimator's floor reading of 1 tok/s against a sub-0.5
// calibration factor rendered the impossible "⚡ 0 tok/s" (token flow had been
// observed).
import { fmtNum, format } from "./format"
import { liveRateDisplayValue } from "./live-rate"
import { TOTAL_SCOPE_LABELS } from "./settings"
import type { TotalScope } from "./settings"

// Inputs for composePanelSessionLines. The component resolves each value from
// its host/signal reads; this function owns the branch selection and the
// formatting so it has no context dependency of its own.
export type PanelSessionLineSources = {
  sessionID: string | undefined
  running: boolean
  started: number | undefined
  last: number | undefined
  now: number
  liveTokensPerSecond: number | undefined
  calibrationFactor: number
  exactRate: number | undefined
  avgRate: number | undefined
  totalScope: TotalScope
  scopeStats: any
}

export function composePanelSessionLines(sources: PanelSessionLineSources): string[] {
  if (!sources.sessionID) return []
  const lines: string[] = ["── 当前会话 ──"]
  if (sources.running && sources.started !== undefined) {
    let line = `  ⏱ ${format(sources.now - sources.started)}`
    const displayedRate = liveRateDisplayValue(
      sources.liveTokensPerSecond,
      sources.calibrationFactor,
    )
    if (displayedRate !== undefined) line += `   ⚡ ${displayedRate} tok/s`
    lines.push(line)
  } else if (sources.running) {
    lines.push("  ⏳")
  } else if (sources.last !== undefined) {
    let line = `  🏁 ${format(sources.last)}`
    if (sources.exactRate !== undefined) {
      line += `   ⚡ ${sources.exactRate} tok/s`
    } else if (sources.avgRate !== undefined) {
      line += `   ⚡ ${sources.avgRate} tok/s avg`
    }
    lines.push(line)
  } else {
    lines.push("  (空闲)")
  }
  // v0.7.7: the panel-header Σ follows the persisted total scope.
  if (sources.scopeStats) {
    const scopeTokens = sources.scopeStats?.tokens
    const total =
      (scopeTokens?.input ?? 0) + (scopeTokens?.output ?? 0) + (scopeTokens?.reasoning ?? 0)
    if (total > 0) lines.push(`  Σ ${TOTAL_SCOPE_LABELS[sources.totalScope]} ${fmtNum(total)}`)
  }
  return lines
}
