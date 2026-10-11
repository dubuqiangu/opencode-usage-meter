// 0.7.19-probe: real-machine diagnostic counters for the idle-freeze
// investigation. Every channel logs its first hit and then every
// RATE_LIMIT-th hit, so a 30s idle run yields a handful of lines per
// channel. Channel history: 0.7.17/0.7.18 wrote console.error assuming
// it reached the host log (docs/guides/tui-plugin-pitfalls.md #11), but
// a full read of opencode.log on 2026-10-11 (26MB spanning 0.7.8-0.7.18,
// host 2.0.x) showed ZERO plugin lines - the host never captures plugin
// console output, so both probe rounds drained to a dead channel. Lines
// now append directly to ~/.local/share/opencode/usage-meter-probe.log
// (the same write-your-own-log approach oh-my-opencode-slim uses).
// Remove this file (and all probe call sites) once the freeze is closed.
import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const RATE_LIMIT = 20

const probeLogDir = join(homedir(), ".local", "share", "opencode")
const probeLogFilePath = join(probeLogDir, "usage-meter-probe.log")

let probeLogDirReady = false

// Diagnostic output must never break the plugin itself.
function writeProbeLine(line: string): void {
  try {
    if (!probeLogDirReady) {
      mkdirSync(probeLogDir, { recursive: true })
      probeLogDirReady = true
    }
    appendFileSync(probeLogFilePath, `${new Date().toISOString()} ${line}\n`, "utf8")
  } catch {
    // Swallow: probe output is best-effort.
  }
}

const counters = new Map<string, number>()

export function probeCount(tag: string, detail?: () => string): void {
  const hits = (counters.get(tag) ?? 0) + 1
  counters.set(tag, hits)
  if (hits === 1 || hits % RATE_LIMIT === 0) {
    writeProbeLine(`[usage-meter][probe] ${tag} #${hits}${detail ? ` ${detail()}` : ""}`)
  }
}

export function probeNote(tag: string, detail?: () => string): void {
  writeProbeLine(`[usage-meter][probe] ${tag}${detail ? ` ${detail()}` : ""}`)
}
