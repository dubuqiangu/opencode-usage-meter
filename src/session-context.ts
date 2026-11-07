// Read-only context accessors shared by the footer, sidebar and panel
// surfaces. Each used to carry its own copy of the same guarded host read;
// centralizing them keeps the degradation rules identical (a throwing stale
// client handle must never poison a render chain).
//
// v0.7.26: router.current() is a host client call like status() — a throwing
// handle would propagate through the slot render stack and kill the surface
// until re-mount, so both degrade instead of throwing. The extraction mirrors
// the stats-panel superset form (route.sessionID on session routes) so every
// surface survives the same host route-shape changes.
export function currentSessionID(context: any, slotProps?: any): string | undefined {
  try {
    const route: any = context.ui?.router?.current?.()
    return (
      slotProps?.sessionID ??
      (route?.type === "session"
        ? (route.sessionID ?? route.params?.sessionID)
        : route?.params?.sessionID)
    )
  } catch {
    return undefined
  }
}

// 0.7.21: the host client's status() can throw (e.g. after a server restart
// the client handle can go bad). `?.` only guards a missing method, not a
// throwing one — and a throw inside a memo runs in the same reactive instance
// as the reconciler's effects, so it would poison the render chain. Degrade to
// "not running" instead.
export function isSessionRunning(context: any, sessionID: string): boolean {
  try {
    return context.data?.session?.status?.(sessionID) === "running"
  } catch {
    return false
  }
}
