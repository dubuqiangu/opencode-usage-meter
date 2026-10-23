// Footer row composition helpers. The status row is built as a list of
// segments and then collapsed into one renderable run per tone — a run is
// the unit that can carry a single fg and attribute set in the TUI text API.
//
// Split out of components/footer-status.tsx in v0.7.35 so the separator
// arithmetic is plain, renderer-free and unit-testable (the .tsx module
// cannot be imported by the Node test runner: it holds JSX).
export type FooterSegment = { text: string; dim?: boolean }

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
