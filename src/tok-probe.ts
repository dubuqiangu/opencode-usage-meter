// TEMPORARY (v0.7.28): tok/s disappearance investigation probe — DELETE this
// module and its call sites once the evidence is collected.
//
// Symptom under investigation: while a session is running, the footer ⚡
// segment briefly disappears (the ⏱ timer keeps ticking). The ⚡ segment
// renders only when the session is running AND liveRate() finds a usable
// sample window. Two candidate causes produce exactly this symptom:
//   A. rate-model.ts's 4s freshness gate (by design: tool runs / long gaps)
//   B. the host/provider not broadcasting streaming deltas for stretches of
//      the run, so no samples arrive at all
// The gate tap records the exact reason the segment is missing, whenever
// that reason changes plus a 2s heartbeat while missing (so durations are
// measurable). The event tap records lifecycle events and a per-second delta
// rate, which also shows whether execution.succeeded arrives per step (that
// would rebuild the sample window at every step boundary).
import { appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const TOK_PROBE_PATH = join(tmpdir(), "usage-meter-tok-probe.log")

const writeProbeLine = (line: string): void => {
  const stamped = `${new Date().toISOString()} ${line}`
  try {
    appendFileSync(TOK_PROBE_PATH, `${stamped}\n`)
  } catch {}
  try {
    console.error(`[usage-meter][tok-probe] ${line}`)
  } catch {}
}

let lastGateReason = ""
let lastGateWriteAt = 0
let deltasSinceFlush = 0
let deltaWindowStartedAt = Date.now()

// Event tap, wired into tui.tsx's listen(): delta events are aggregated into
// a per-second rate line; lifecycle events are logged individually.
export const probeEvent = (type: string): void => {
  if (type.endsWith(".delta")) {
    deltasSinceFlush++
    const elapsedMs = Date.now() - deltaWindowStartedAt
    if (elapsedMs >= 1000) {
      writeProbeLine(
        `deltas/s=${Math.round((deltasSinceFlush * 1000) / elapsedMs)} last=${type}`,
      )
      deltasSinceFlush = 0
      deltaWindowStartedAt = Date.now()
    }
    return
  }
  writeProbeLine(`event ${type}`)
}

export type TokProbeGateFields = {
  sessionID: string
  running: boolean
  rawStatus: any
  hasStarted: boolean
  sampleCount: number
  lastSampleAgeMs: number
  computedRate: number | undefined
}

// Gate tap, wired into the footer status memo: logs whenever the reason the
// ⚡ segment is missing changes, plus a heartbeat every 2s while missing.
export const probeGate = (fields: TokProbeGateFields): void => {
  const reason = !fields.running
    ? "not-running"
    : !fields.hasStarted
      ? "no-start"
      : fields.sampleCount < 2
        ? "samples<2"
        : fields.lastSampleAgeMs > 4000
          ? "stale>4s"
          : fields.computedRate === undefined
            ? "gate(dt-or-zero)"
            : "ok"
  const now = Date.now()
  if (reason === lastGateReason) {
    if (reason === "ok" || now - lastGateWriteAt < 2000) return
  }
  lastGateReason = reason
  lastGateWriteAt = now
  writeProbeLine(
    `gate reason=${reason} sid=…${String(fields.sessionID).slice(-6)} status=${String(fields.rawStatus)}` +
      ` running=${fields.running ? 1 : 0} started=${fields.hasStarted ? 1 : 0} samples=${fields.sampleCount}` +
      ` lastAgeMs=${Number.isFinite(fields.lastSampleAgeMs) ? Math.round(fields.lastSampleAgeMs) : "inf"}` +
      ` rate=${fields.computedRate ?? "-"}`,
  )
}
