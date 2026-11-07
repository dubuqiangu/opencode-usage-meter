// Keymap-layer lifecycle helpers. A layer handle can be returned either as a
// plain dispose function or as an object with a dispose() method; both the
// stats panel's "f" fullscreen layer and the settings dialog's d/s/f/h/b
// layer need the same release logic, which used to be duplicated verbatim.
//
// v0.7.36: layer creation can fail on the first host render (the app slot's
// first render may land before Keymap.Provider exists). A single failed
// attempt must not kill the layer for the whole session, so creation is
// retried, throttled by this decision helper.
export function shouldAttemptLayerCreate(
  now: number,
  layerDispose: unknown,
  layerFailureAt: number,
  intervalMs: number,
): boolean {
  return (
    layerDispose === undefined &&
    (layerFailureAt === 0 || now - layerFailureAt >= intervalMs)
  )
}

export type DisposableLayer = {
  current: () => any
  set: (handle: any) => void
  dispose: () => void
}

// Release whichever shape the host handed back (a function or a { dispose }
// object), then reset the handle so a later guarded create can re-arm. A null
// handle (recorded when creation threw) is treated as "already released".
export function createDisposableLayer(): DisposableLayer {
  let handle: any
  return {
    current: () => handle,
    set: (next) => {
      handle = next
    },
    dispose: () => {
      if (typeof handle === "function") {
        try {
          handle()
        } catch {}
      } else if (handle && typeof handle.dispose === "function") {
        try {
          handle.dispose()
        } catch {}
      }
      handle = undefined
    },
  }
}
