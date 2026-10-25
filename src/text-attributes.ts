// TextAttributes.DIM from @opentui/core (SGR 2), inlined as a number: src/ may
// only import host-provided specifiers (@opentui/solid / solid-js /
// @opencode/*), and `@opentui/core` is not one of them — importing it breaks
// the delivery contract and, worse, the host's module resolution at load time
// (pitfall #16). The value is a stable part of the attribute bitmask
// (NONE 0, BOLD 1, DIM 2, ITALIC 4, UNDERLINE 8, …), read from the host's own
// types.js next to the package (DIM: 1 << 1). The `attributes` prop itself is
// a declared text option (TextOptions extends TextBufferOptions in
// @opentui/core/renderables), and the text setter forwards it to
// setDefaultAttributes + requestRender, so it re-paints on the tick.
export const DIM_TEXT_ATTRIBUTE = 1 << 1
