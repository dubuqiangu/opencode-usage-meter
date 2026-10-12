// Slot mounts that own their reactive effects (0.7.22).
//
// Real-machine verdict (pitfall #13, 2026-10-12 probes): when a slot render
// returns JSX whose function children are meant to become tracked thunks, it
// is the HOST that inserts those children — with the host's own
// @opentui/solid copy and its own solid-js instance. The render effects land
// in the host's module graph; our plugin-side memos can never register with
// them (solid's observer stack is per module instance), so the drawn tree
// freezes at the mount-time snapshot while our memos recompute forever.
//
// The fix mirrors OMO-Slim's reactiveElement: before the element reaches the
// host, insert the render function into a plain core box OURSELVES, so every
// render effect lives in the plugin's own module graph — the same graph as
// our signals and memos — and updates propagate normally.
//
// Renderer context (0.7.23, real-machine crash "No renderer found"):
// @opentui/solid's createElement resolves the renderer via
// useContext(RendererContext) — a solid context carried on the OWNER chain.
// During our slot render call the host has that context provided (that's how
// the old JSX path worked at all), but createRoot() creates a DETACHED root
// whose context is null unless a detachedOwner is passed. Pass the ambient
// owner (getOwner(), captured inside swap() while the host-called slot render
// is on the stack) so the new root inherits the same context object and
// createElement can find the renderer.
import { createElement, insert, setProp } from "@opentui/solid"
import { createRoot, getOwner } from "solid-js/dist/solid.js"

export type SlotMount = {
  root: any
  dispose: () => void
}

function mountReactiveRoot(render: () => any, verticalLayout: boolean): SlotMount {
  let disposeOwner: (() => void) | undefined
  // swap() runs inside the host-called slot render, so the ambient owner
  // carries the host-provided RendererContext; hand it to createRoot so the
  // detached root inherits that context (solid: root.context = current.context).
  const ambientOwner = getOwner()
  const root = createRoot((dispose) => {
    disposeOwner = dispose
    const box = createElement("box")
    if (verticalLayout) {
      setProp(box, "width", "100%")
      setProp(box, "flexDirection", "column")
    }
    insert(box, render)
    return box
  }, ambientOwner ?? undefined)
  return {
    root,
    dispose: () => {
      try {
        disposeOwner?.()
      } catch {}
    },
  }
}

// Per-slot mount lifecycle: every host-driven slot re-render swaps in a
// fresh reactive root and disposes the previous root's reactive graph. The
// host re-renders the footer slot on nearly every input event — without the
// swap, each remount would leak a live effect chain writing into detached
// renderables on every 500ms tick.
export function createReactiveSlotMount(verticalLayout: boolean) {
  let current: SlotMount | undefined
  return {
    swap(render: () => any): any {
      current?.dispose()
      current = mountReactiveRoot(render, verticalLayout)
      return current.root
    },
    release() {
      current?.dispose()
      current = undefined
    },
  }
}
