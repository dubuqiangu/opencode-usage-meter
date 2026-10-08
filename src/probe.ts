// 0.7.17-probe: real-machine diagnostic counters for the idle-freeze
// investigation. Every channel logs its first hit and then every
// RATE_LIMIT-th hit, so a 30s idle run yields a handful of lines per
// channel. Output goes to console.error -> host log (read with a
// FileShare-ReadWrite open, docs/guides/tui-plugin-pitfalls.md #11).
// Remove this file (and all probe call sites) once the freeze is closed.
const RATE_LIMIT = 20

const counters = new Map<string, number>()

export function probeCount(tag: string, detail?: () => string): void {
  const hits = (counters.get(tag) ?? 0) + 1
  counters.set(tag, hits)
  if (hits === 1 || hits % RATE_LIMIT === 0) {
    console.error(`[usage-meter][probe] ${tag} #${hits}${detail ? ` ${detail()}` : ""}`)
  }
}

export function probeNote(tag: string, detail?: () => string): void {
  console.error(`[usage-meter][probe] ${tag}${detail ? ` ${detail()}` : ""}`)
}
