// Durable storage-store bootstrap shared by the calibration and settings
// factories. Both used to carry their own copy of the same `context.storage
// .store(name, { initial })` guarded read; calibration stayed silent on a
// missing/failed store while settings logged it, so the two drifted. This is
// the single place that opens a store and reports why it could not.
//
// The host owns the store's lifetime, so there is nothing to release at
// teardown — `noopRelease` documents that shared verdict for both factories.
export type DurableStore<T> = {
  state: T
  update: ((fn: (draft: T) => void) => Promise<void>) | undefined
}

export function openStore<T>(context: any, name: string, initial: T): DurableStore<T> {
  try {
    const store = (context.storage as any)?.store
    if (typeof store === "function") {
      const [state, update] = store(name, { initial })
      return { state: (state as T) ?? initial, update }
    }
    // A missing storage.store used to be a fully silent no-op — every write
    // then "succeeded" without persisting anything. Log it once so the host
    // incompatibility is visible in the dev log.
    console.error(`[usage-meter] storage.store unavailable — ${name} will not persist`)
    return { state: initial, update: undefined }
  } catch (error) {
    // Same visibility rule for a store creation that throws.
    console.error(`[usage-meter] ${name} store creation failed:`, error)
    return { state: initial, update: undefined }
  }
}

// The durable store is host-managed; the original cleanups released nothing
// for it, so release is a deliberate no-op kept for the factory interface.
export const noopRelease = (): void => {}
