// Durable user settings (footer/sidebar dimension toggles). Split from
// tui.tsx in v0.7.x — behavior unchanged.

export type TotalScope = "today" | "24h" | "7d" | "30d"
export const TOTAL_SCOPES: readonly TotalScope[] = ["today", "24h", "7d", "30d"]
// Human labels for the panel/settings dialog (Chinese surfaces); the
// sidebar block keeps the raw scope as its English range tag.
export const TOTAL_SCOPE_LABELS: Record<TotalScope, string> = {
  today: "今日",
  "24h": "近24小时",
  "7d": "近7日",
  "30d": "近30日",
}

export type SettingsApi = {
  settingsStore: any
  updateSettings: ((fn: (draft: any) => void) => Promise<void>) | undefined
  hitScopeEnabled: () => "today" | "session"
  totalScopeEnabled: () => TotalScope
  footerSigmaEnabled: () => boolean
  footerHitEnabled: () => boolean
  sidebarMetricsEnabled: () => boolean
  statsBlockCollapsed: () => boolean
  toggleSettingsFlag: (flagKey: string, currentValue: boolean) => void
  toggleHitScope: () => void
  cycleTotalScope: () => void
  release: () => void
}

export function createSettings(context: any): SettingsApi {
  // v0.6.6: user-facing footer dimension settings (durable, synced across
  // TUI instances). The user host (2.0.21) has no plugin-options config
  // channel yet, so settings persist here and toggle via /usage-settings.
  let settingsStore: any = {}
  let updateSettingsStore: ((fn: (draft: any) => void) => Promise<void>) | undefined
  try {
    const store = (context.storage as any)?.store
    if (typeof store === "function") {
      const [s, u] = store("usage-meter.settings", {
        initial: {
          hitScope: "today" as "today" | "session",
          // v0.7.0: the footer defaults to waited + tok/s only; the Σ and
          // hit segments are opt-in. The right-sidebar metrics block is on
          // by default. Absent keys fall back to these defaults on read.
          footerSigma: false,
          footerHit: false,
          sidebarMetrics: true,
          // v0.7.7: rolling secondary dimension for the Σ/📊 total
          // (today | last 24h | last 7d | last 30d). Absent key reads as
          // "today", matching pre-0.7.7 behavior.
          totalScope: "today" as TotalScope,
          // v0.7.9: click-to-collapse state of the right-sidebar Stats
          // header (mirrors the native MCP / OMO-Slim section headers).
          // Absent key reads as expanded, matching pre-0.7.9 behavior.
          statsBlockCollapsed: false,
        },
      })
      settingsStore = s ?? {}
      updateSettingsStore = u
    } else {
      // v0.7.12: a missing storage.store used to be a fully silent no-op —
      // every toggle then "succeeded" without persisting anything. Log it
      // once so the host incompatibility is visible in the dev log.
      console.error("[usage-meter] storage.store unavailable — settings will not persist")
    }
  } catch (error) {
    // v0.7.12: same visibility rule for a store creation that throws.
    console.error("[usage-meter] settings store creation failed:", error)
  }

  // Normalized settings readers: persisted stores from older versions lack
  // the newer keys, so each reader applies the documented default itself.
  const hitScopeEnabled = (): "today" | "session" =>
    settingsStore?.hitScope === "session" ? "session" : "today"
  // v0.7.7: normalized total-scope reader — invalid/absent persisted values
  // fall back to "today".
  const totalScopeEnabled = (): TotalScope =>
    TOTAL_SCOPES.includes(settingsStore?.totalScope)
      ? (settingsStore.totalScope as TotalScope)
      : "today"
  const footerSigmaEnabled = (): boolean => settingsStore?.footerSigma === true
  const footerHitEnabled = (): boolean => settingsStore?.footerHit === true
  const sidebarMetricsEnabled = (): boolean => settingsStore?.sidebarMetrics !== false
  // v0.7.9: true = the Stats header is collapsed (metrics lines hidden);
  // absent key reads as expanded.
  const statsBlockCollapsed = (): boolean => settingsStore?.statsBlockCollapsed === true
  // v0.7.12: an absent update path is an explicit dead end now — log it
  // instead of silently doing nothing (the caller's UI would otherwise
  // believe the toggle worked).
  const toggleSettingsFlag = (flagKey: string, currentValue: boolean): void => {
    if (!updateSettingsStore) {
      console.error(`[usage-meter] settings store unavailable — cannot toggle ${flagKey}`)
      return
    }
    try {
      void updateSettingsStore((draft: any) => {
        draft[flagKey] = !currentValue
      })
    } catch {}
  }

  const toggleHitScope = (): void => {
    if (!updateSettingsStore) {
      console.error("[usage-meter] settings store unavailable — cannot switch hit scope")
      return
    }
    try {
      const nextHitScope = hitScopeEnabled() === "session" ? "today" : "session"
      void updateSettingsStore((draft: any) => {
        draft.hitScope = nextHitScope
      })
    } catch {}
  }

  // v0.7.7: cycle the Σ/📊 total dimension today -> 24h -> 7d -> 30d -> today.
  const cycleTotalScope = (): void => {
    if (!updateSettingsStore) {
      console.error("[usage-meter] settings store unavailable — cannot cycle total scope")
      return
    }
    try {
      const currentIndex = TOTAL_SCOPES.indexOf(totalScopeEnabled())
      const nextTotalScope = TOTAL_SCOPES[(currentIndex + 1) % TOTAL_SCOPES.length]
      void updateSettingsStore((draft: any) => {
        draft.totalScope = nextTotalScope
      })
    } catch {}
  }

  // The durable store is host-managed; the original cleanup released
  // nothing for it, so release is a deliberate no-op kept for the
  // factory interface.
  const release = (): void => {}

  return {
    settingsStore,
    updateSettings: updateSettingsStore,
    hitScopeEnabled,
    totalScopeEnabled,
    footerSigmaEnabled,
    footerHitEnabled,
    sidebarMetricsEnabled,
    statsBlockCollapsed,
    toggleSettingsFlag,
    toggleHitScope,
    cycleTotalScope,
    release,
  }
}
