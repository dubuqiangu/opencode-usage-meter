// Right-sidebar metrics block: the visibility gate and the line assembly,
// lifted out of components/sidebar-metrics.tsx so both are pure,
// renderer-free and unit-testable (the .tsx module cannot be imported by the
// Node test runner: it holds JSX). Segment/line order, dim placement and the
// collapsed branch are preserved exactly.
import { fmtNum, format } from "./format"
import { dailyHitRatio, sessionHitRatio } from "./hit-rate"
import { liveRateDisplayValue, resolveLiveRateReading } from "./live-rate"
import type { LiveRateMemoryEntry } from "./live-rate"
import type { TotalScope } from "./settings"

export type SidebarBlockLine = { text: string; dim: boolean }

export type SidebarBlockState = {
  collapsed: boolean
  lines: SidebarBlockLine[]
}

// Inputs for composeSidebarBlock. Every source is a thunk so the reads happen
// in the same order and with the same laziness as the original memo: while
// collapsed, none of the stats/status reads run at all.
export type SidebarBlockSources = {
  now: () => number
  collapsed: () => boolean
  running: () => boolean
  started: () => number | undefined
  last: () => number | undefined
  exactRate: () => number | undefined
  avgRate: () => number | undefined
  liveTokensPerSecond: (currentTime: number) => number | undefined
  calibrationFactor: () => number
  liveMemory: Map<string, LiveRateMemoryEntry>
  sessionID: string
  todayStats: () => any
  hitScope: () => "today" | "session"
  totalScope: () => TotalScope
  scopeStats: (scope: TotalScope) => any
  sessionTokens: () => any
}

export function composeSidebarBlock(sources: SidebarBlockSources): SidebarBlockState {
  const currentTime = sources.now()
  const collapsed = sources.collapsed()
  const lines: SidebarBlockLine[] = []
  if (!collapsed) {
    const running = sources.running()
    const started = sources.started()
    const last = sources.last()
    // v0.7.1: narrow column — split time and rate onto separate lines,
    // English-only labels, and unify the scope suffix in parentheses.
    if (running && started !== undefined) {
      lines.push({ text: `⏱ ${format(currentTime - started)}`, dim: false })
      const reading = resolveLiveRateReading(
        sources.liveMemory,
        sources.sessionID,
        started,
        liveRateDisplayValue(sources.liveTokensPerSecond(currentTime), sources.calibrationFactor()),
      )
      if (reading !== undefined) {
        lines.push({ text: `⚡ ${reading.tokensPerSecond} tok/s`, dim: reading.dim })
      }
    } else if (running) {
      lines.push({ text: "⏳", dim: false })
    } else if (last !== undefined) {
      lines.push({ text: `🏁 ${format(last)}`, dim: false })
      const exact = sources.exactRate()
      const avgRate = sources.avgRate()
      if (exact !== undefined) lines.push({ text: `⚡ ${exact} tok/s`, dim: false })
      else if (avgRate !== undefined) lines.push({ text: `⚡ ${avgRate} tok/s avg`, dim: false })
    }
    const stats = sources.todayStats()
    const hitScope = sources.hitScope()
    // v0.7.7: the 📊 total follows the persisted scope — today is the
    // default; rolling windows (24h/7d/30d) are separate read-only queries.
    const totalScope = sources.totalScope()
    const scopeStats = sources.scopeStats(totalScope)
    if (scopeStats) {
      const scopeTokens = scopeStats?.tokens
      const freshTokensTotal =
        (scopeTokens?.input ?? 0) + (scopeTokens?.output ?? 0) + (scopeTokens?.reasoning ?? 0)
      // v0.7.15: dual reading — same scope, cache-inclusive grand total shown
      // after the fresh-compute Σ/📊 metric; omitted when there is no cache.
      const cacheInclusiveTotal =
        freshTokensTotal + (scopeTokens?.cache?.read ?? 0) + (scopeTokens?.cache?.write ?? 0)
      if (freshTokensTotal > 0) {
        lines.push({
          text:
            cacheInclusiveTotal > freshTokensTotal
              ? `📊 ${fmtNum(freshTokensTotal)} / ${fmtNum(cacheInclusiveTotal)} (${totalScope})`
              : `📊 ${fmtNum(freshTokensTotal)} (${totalScope})`,
          dim: false,
        })
      }
    }
    if (hitScope === "session") {
      const sessionTokens = sources.sessionTokens()
      const sessionRatio = sessionHitRatio(
        sessionTokens?.cache?.read ?? 0,
        sessionTokens?.input ?? 0,
        sessionTokens?.cache?.write ?? 0,
      )
      if (sessionRatio !== undefined)
        lines.push({ text: `🎯 ${(sessionRatio * 100).toFixed(1)}% (session)`, dim: false })
    } else if (stats) {
      const dailyRatio = dailyHitRatio(
        stats?.tokens?.cache?.read ?? 0,
        stats?.tokens?.input ?? 0,
      )
      if (dailyRatio !== undefined)
        lines.push({ text: `🎯 ${(dailyRatio * 100).toFixed(1)}% (today)`, dim: false })
    }
  }
  return { collapsed, lines }
}

// The block's visibility gate (the former `hasContent` memo body).
// v0.7.38 (B1): `readTick()` is called unconditionally, BEFORE the on/off
// early return. Solid clears the sources registered by the previous
// recompute on every run, so an early return that skipped the `now()` read
// made the memo drop its tick dependency — on a non-reactive host the
// off->on flip then never recomputed the block back to visible.
export function shouldShowSidebarBlock(
  sidebarMetricsEnabled: () => boolean,
  readState: () => SidebarBlockState,
  readTick: () => void,
): boolean {
  readTick()
  if (!sidebarMetricsEnabled()) return false
  const state = readState()
  return state.collapsed || state.lines.length > 0
}
