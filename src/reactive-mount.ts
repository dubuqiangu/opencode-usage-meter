// Slot mounts following the OMO-Slim reactiveElement pattern (0.7.24).
//
// Real-machine case history (pitfall #13/#15, 2026-10-11..14):
// - Host-side insertion of function children puts the render effects in the
//   host's graph while our memos lived elsewhere — the screen froze at the
//   mount-time snapshot (0.7.8-0.7.21).
// - 0.7.22 fixed the ownership direction but added a detached createRoot:
//   `createElement` resolves the renderer via useContext(RendererContext),
//   which a detached root cannot see ("No renderer found" on the real
//   machine — crashes in slot renders).
// - 0.7.24 removed the peerDependencies shadow copies, so "solid-js" and
//   "@opentui/solid" now resolve to the host-provided modules — the same
//   graph the host's slot machinery runs in, exactly like OMO-Slim, which
//   ships with no @opentui/solid-js deps at all and imports bare
//   specifiers.
//
// This module now mirrors OMO-Slim's reactiveElement exactly: build a core
// box with createElement, insert the render fn at the slot-render ambient
// position. No createRoot — the insert's render effect lands in the same
// solid graph that is active during the slot render, where our
// signals/memos are first-class dependencies and the slot machinery's
// RendererContext provider is on the owner chain (that is why plain
// createElement works here and did not inside a detached root). Lifecycle:
// the host slot machinery re-evaluates the render on remounts and solid
// disposes the previous owned effect tree on computation re-runs — the
// same lifecycle OMO-Slim's sidebar lives by.
import { createElement, insert, setProp } from "@opentui/solid"

export type SlotMount = {
  root: any
  // Lifecycle is owned by the host slot machinery's computation tree (see
  // header) — nothing to dispose from our side; kept for API compatibility.
  dispose: () => void
}

function mountReactiveRoot(render: () => any, verticalLayout: boolean): SlotMount {
  const box = createElement("box")
  if (verticalLayout) {
    setProp(box, "width", "100%")
    setProp(box, "flexDirection", "column")
  }
  insert(box, render)
  return {
    root: box,
    dispose: () => {},
  }
}

// Per-slot mount lifecycle. Every host-driven slot re-render swaps in a
// fresh mount; the previous mount's effect tree is torn down by the host
// machinery re-evaluating the slot (solid disposes a computation's owned
// tree before re-running it).
export function createReactiveSlotMount(verticalLayout: boolean) {
  let current: SlotMount | undefined
  return {
    swap(render: () => any): any {
      current = mountReactiveRoot(render, verticalLayout)
      return current.root
    },
    release() {
      current = undefined
    },
  }
}
