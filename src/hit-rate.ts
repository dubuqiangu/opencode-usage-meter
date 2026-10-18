// Cache-hit ratio math shared by the three live surfaces (footer Σ/hit
// segments, right-sidebar metrics block, /usage-full detail tables).
// Extracted in v0.7.27 — each surface used to carry its own copy of the same
// arithmetic; a formula change had to be repeated in every copy.
//
// Both helpers return a 0..1 ratio, or undefined when there is no input
// context to rate. They deliberately return the raw ratio: each call site
// keeps its own display rounding (integer percent in the panel tables, one
// decimal in the live tick-driven surfaces, where an integer percent looks
// frozen while the underlying counts move).

// Strict session formula — read / (input + read + write). Matches the native
// sidebar Context panel; shown as "hit·s" in the footer.
export const sessionHitRatio = (
  cacheRead: number,
  input: number,
  cacheWrite: number,
): number | undefined => {
  const denominator = input + cacheRead + cacheWrite
  return denominator > 0 ? cacheRead / denominator : undefined
}

// Daily aggregate formula — read / (read + input), over all sessions.
export const dailyHitRatio = (cacheRead: number, input: number): number | undefined => {
  const denominator = cacheRead + input
  return denominator > 0 ? cacheRead / denominator : undefined
}
