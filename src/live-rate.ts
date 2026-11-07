// Shared live-rate display rule for the two surfaces that show ⚡ (the footer
// row and the right-sidebar block). 0.7.35 introduced "hold the last live
// reading and dim it" in the footer only; 0.7.37 moved the rule here so both
// surfaces resolve it identically and can never drift apart again.
//
// The memory is keyed by session and stamped with the turn's start time. The
// stamp is what keeps this honest across a turn boundary: a new turn has a new
// `started`, so a mismatched entry reads as "no memory" instead of reviving the
// previous turn's number for the first seconds of the new turn.
export type LiveRateMemoryEntry = { turnStartedAt: number; tokensPerSecond: number }

export type LiveRateReading = { tokensPerSecond: number; dim: boolean }

// Apply the per-session calibration factor to a raw live reading, then floor
// it at 1. v0.7.38 (B2): the estimator's live rate can be as low as 1 tok/s
// while the calibration floor is 0.25, so `Math.round(1 * 0.25)` rendered the
// impossible "⚡ 0 tok/s" (token flow had been observed) and stored that 0 in
// the held memory too. A positive live reading must never be displayed as 0.
export function liveRateDisplayValue(
  liveTokensPerSecond: number | undefined,
  calibrationFactor: number,
): number | undefined {
  if (liveTokensPerSecond === undefined) return undefined
  return Math.max(1, Math.round(liveTokensPerSecond * calibrationFactor))
}

export function resolveLiveRateReading(
  memory: Map<string, LiveRateMemoryEntry>,
  sessionID: string,
  turnStartedAt: number,
  liveTokensPerSecond: number | undefined,
): LiveRateReading | undefined {
  if (liveTokensPerSecond !== undefined) {
    memory.set(sessionID, { turnStartedAt, tokensPerSecond: liveTokensPerSecond })
    return { tokensPerSecond: liveTokensPerSecond, dim: false }
  }
  const held = memory.get(sessionID)
  if (held === undefined || held.turnStartedAt !== turnStartedAt) return undefined
  return { tokensPerSecond: held.tokensPerSecond, dim: true }
}
