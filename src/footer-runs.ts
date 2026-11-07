// Footer row composition helpers. The status row is built as a list of
// segments and then collapsed into one renderable run per tone — a run is
// the unit that can carry a single fg and attribute set in the TUI text API.
//
// Split out of components/footer-status.tsx in v0.7.35 so the separator
// arithmetic is plain, renderer-free and unit-testable (the .tsx module
// cannot be imported by the Node test runner: it holds JSX).
import { fmtNum, format } from "./format"
import { dailyHitRatio, sessionHitRatio } from "./hit-rate"
import { liveRateDisplayValue, resolveLiveRateReading } from "./live-rate"
import type { LiveRateMemoryEntry } from "./live-rate"
import type { TotalScope } from "./settings"

export type FooterSegment = { text: string; dim?: boolean }

// Inputs for composeFooterSegments. The component gathers each value from its
// signals outside the pure branch selection below; `readSessionTokens` stays a
// thunk because the host session.get() call is only made on the session-hit
// branch (reading it unconditionally would add a host call per 500ms tick).
export type FooterSegmentSources = {
  now: number
  running: boolean
  started: number | undefined
  last: number | undefined
  exactRate: number | undefined
  avgRate: number | undefined
  liveTokensPerSecond: number | undefined
  calibrationFactor: number
  liveMemory: Map<string, LiveRateMemoryEntry>
  sessionID: string
  footerSigmaEnabled: boolean
  totalScope: TotalScope
  scopeStats: any
  footerHitEnabled: boolean
  hitScope: "today" | "session"
  readSessionTokens: () => any
  todayStats: any
}

// The footer row's branch selection, lifted verbatim out of the slot memo so
// it is a pure, renderer-free function the Node test runner can cover (the
// .tsx module cannot be imported: it holds JSX). Segment order, formulas,
// dim placement and the null empty-state are all preserved exactly.
export function composeFooterSegments(sources: FooterSegmentSources): FooterSegment[] | null {
  const parts: FooterSegment[] = []
  if (sources.running && sources.started !== undefined) {
    // v0.7.3: icon-only state labels — ⏱ elapsed while waiting, ⏳ running
    // without a start timestamp, 🏁 last turn. No textual state words.
    parts.push({ text: `⏱ ${format(sources.now - sources.started)}` })
    const reading = resolveLiveRateReading(
      sources.liveMemory,
      sources.sessionID,
      sources.started,
      liveRateDisplayValue(sources.liveTokensPerSecond, sources.calibrationFactor),
    )
    if (reading !== undefined) {
      const segment: FooterSegment = { text: `⚡ ${reading.tokensPerSecond} tok/s` }
      // Only set `dim` when true: coalesceFooterRuns groups by strict
      // equality, and `dim: false` would split off a run from the
      // neighbouring segments whose flag is `undefined`.
      if (reading.dim) segment.dim = true
      parts.push(segment)
    }
  } else if (sources.running) {
    parts.push({ text: `⏳` })
  } else if (sources.last !== undefined) {
    // v0.7.2: checkered flag replaces the "✓ last" wording (icon-only
    // labels, consistent with ⏱/⚡/📊/🎯).
    parts.push({ text: `🏁 ${format(sources.last)}` })
    if (sources.exactRate !== undefined) {
      parts.push({ text: `⚡ ${sources.exactRate} tok/s` })
    } else if (sources.avgRate !== undefined) {
      parts.push({ text: `⚡ ${sources.avgRate} tok/s avg` })
    }
  }
  // v0.7.0: Σ/hit footer segments are opt-in via /usage-settings (the footer
  // defaults to waited + tok/s only). v0.7.12: segment order is enforced in
  // both scope branches — Σ always precedes hit.
  if (sources.footerSigmaEnabled && sources.scopeStats) {
    const scopeTokens = sources.scopeStats?.tokens
    const scopeTotal =
      (scopeTokens?.input ?? 0) + (scopeTokens?.output ?? 0) + (scopeTokens?.reasoning ?? 0)
    if (scopeTotal > 0) {
      parts.push({
        text: `Σ ${fmtNum(scopeTotal)}${sources.totalScope === "today" ? "" : ` (${sources.totalScope})`}`,
      })
    }
  }
  if (sources.footerHitEnabled && sources.hitScope === "session") {
    const sessionTokens = sources.readSessionTokens()
    const sessionRatio = sessionHitRatio(
      sessionTokens?.cache?.read ?? 0,
      sessionTokens?.input ?? 0,
      sessionTokens?.cache?.write ?? 0,
    )
    // One decimal: the daily/session ratio is naturally stable, so an
    // integer percent looks frozen while the underlying counts move.
    if (sessionRatio !== undefined)
      parts.push({ text: `hit·s ${(sessionRatio * 100).toFixed(1)}%` })
  }
  if (sources.todayStats && sources.footerHitEnabled && sources.hitScope !== "session") {
    const dailyRatio = dailyHitRatio(
      sources.todayStats?.tokens?.cache?.read ?? 0,
      sources.todayStats?.tokens?.input ?? 0,
    )
    if (dailyRatio !== undefined)
      parts.push({ text: `hit ${(dailyRatio * 100).toFixed(1)}%` })
  }
  return parts.length > 0 ? parts : null
}

// Collapse a segment list into one run per tone. Consecutive segments
// sharing the dim flag are joined with the row's customary three-space gap,
// and the gap that precedes a new run is carried by that run's own string so
// the rendered spacing is identical to the old single joined string.
export const coalesceFooterRuns = (segments: FooterSegment[]): FooterSegment[] => {
  const runs: FooterSegment[] = []
  for (const segment of segments) {
    const lastRun = runs[runs.length - 1]
    if (lastRun !== undefined && lastRun.dim === segment.dim) {
      lastRun.text += `   ${segment.text}`
    } else {
      runs.push({
        text: runs.length > 0 ? `   ${segment.text}` : segment.text,
        dim: segment.dim,
      })
    }
  }
  return runs
}
