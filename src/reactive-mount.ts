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
import { createElement, insert, setProp } from "@opentui/solid"
import { createRoot } from "solid-js/dist/solid.js"

export type SlotMount = {
  root: any
  dispose: () => void
}

function mountReactiveRoot(render: () => any, verticalLayout: boolean): SlotMount {
  let disposeOwner: (() => void) | undefined
  const root = createRoot((dispose) => {
    disposeOwner = dispose
    const box = createElement("box")
    if (verticalLayout) {
      setProp(box, "width", "100%")
      setProp(box, "flexDirection", "column")
    }
    insert(box, render)
    return box
  })
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
