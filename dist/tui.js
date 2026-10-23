// src/tui.tsx
import { Plugin } from "@opencode/plugin/tui";
import { createSignal as createSignal3 } from "solid-js";

// src/calibration.ts
function createCalibration(context) {
  const calibs = /* @__PURE__ */ new Map();
  let calibStore = {};
  let updateCalibStore;
  try {
    const store = context.storage?.store;
    if (typeof store === "function") {
      const [s, u] = store("usage-meter.calib", { initial: {} });
      calibStore = s ?? {};
      updateCalibStore = u;
    }
  } catch {
  }
  const sessionModels = /* @__PURE__ */ new Map();
  const modelKeyOf = (sessionID) => {
    const cached = sessionModels.get(sessionID);
    if (cached) return cached;
    try {
      const s = context.data?.session?.get?.(sessionID);
      if (s?.model) return `${s.model.providerID}/${s.model.id}`;
    } catch {
    }
    return void 0;
  };
  const calibOf = (sessionID) => {
    const live = calibs.get(sessionID);
    if (live !== void 0) return live;
    const key = modelKeyOf(sessionID);
    const persisted = key ? calibStore[key] : void 0;
    return typeof persisted === "number" && persisted > 0 ? persisted : 1;
  };
  const learnCalibration = (sessionID, before, out) => {
    if (out > 0 && before > 20) {
      const prev = calibs.get(sessionID) ?? calibOf(sessionID);
      const next = Math.min(4, Math.max(0.25, prev * 0.7 + out / before * 0.3));
      calibs.set(sessionID, next);
      const modelKey = modelKeyOf(sessionID);
      if (modelKey && updateCalibStore) {
        try {
          void updateCalibStore((draft) => {
            draft[modelKey] = next;
          }).catch(
            (error) => console.error(`[usage-meter] failed to persist calibration for ${modelKey}`, error)
          );
        } catch {
        }
      }
    }
  };
  const rememberSessionModel = (sessionID, model) => {
    sessionModels.set(sessionID, `${model.providerID}/${model.id}`);
  };
  const release = () => {
  };
  return { calibOf, learnCalibration, rememberSessionModel, release };
}

// src/settings.ts
var TOTAL_SCOPES = ["today", "24h", "7d", "30d"];
var TOTAL_SCOPE_LABELS = {
  today: "\u4ECA\u65E5",
  "24h": "\u8FD124\u5C0F\u65F6",
  "7d": "\u8FD17\u65E5",
  "30d": "\u8FD130\u65E5"
};
var nextTotalScope = (current) => {
  const currentIndex = TOTAL_SCOPES.indexOf(current);
  return TOTAL_SCOPES[(currentIndex + 1) % TOTAL_SCOPES.length];
};
function createSettings(context) {
  let settingsStore = {};
  let updateSettingsStore;
  try {
    const store = context.storage?.store;
    if (typeof store === "function") {
      const [s, u] = store("usage-meter.settings", {
        initial: {
          hitScope: "today",
          // v0.7.0: the footer defaults to waited + tok/s only; the Σ and
          // hit segments are opt-in. The right-sidebar metrics block is on
          // by default. Absent keys fall back to these defaults on read.
          footerSigma: false,
          footerHit: false,
          sidebarMetrics: true,
          // v0.7.7: rolling secondary dimension for the Σ/📊 total
          // (today | last 24h | last 7d | last 30d). Absent key reads as
          // "today", matching pre-0.7.7 behavior.
          totalScope: "today",
          // v0.7.9: click-to-collapse state of the right-sidebar Stats
          // header (mirrors the native MCP / OMO-Slim section headers).
          // Absent key reads as expanded, matching pre-0.7.9 behavior.
          statsBlockCollapsed: false
        }
      });
      settingsStore = s ?? {};
      updateSettingsStore = u;
    } else {
      console.error("[usage-meter] storage.store unavailable \u2014 settings will not persist");
    }
  } catch (error) {
    console.error("[usage-meter] settings store creation failed:", error);
  }
  const hitScopeEnabled = () => settingsStore?.hitScope === "session" ? "session" : "today";
  const totalScopeEnabled = () => TOTAL_SCOPES.includes(settingsStore?.totalScope) ? settingsStore.totalScope : "today";
  const footerSigmaEnabled = () => settingsStore?.footerSigma === true;
  const footerHitEnabled = () => settingsStore?.footerHit === true;
  const sidebarMetricsEnabled = () => settingsStore?.sidebarMetrics !== false;
  const statsBlockCollapsed = () => settingsStore?.statsBlockCollapsed === true;
  const toggleSettingsFlag = (flagKey, currentValue) => {
    if (!updateSettingsStore) {
      console.error(`[usage-meter] settings store unavailable \u2014 cannot toggle ${flagKey}`);
      return;
    }
    try {
      void updateSettingsStore((draft) => {
        const liveValue = draft[flagKey];
        draft[flagKey] = !(typeof liveValue === "boolean" ? liveValue : currentValue === true);
      }).catch((error) => console.error(`[usage-meter] failed to persist ${flagKey}`, error));
    } catch {
    }
  };
  const toggleHitScope = () => {
    if (!updateSettingsStore) {
      console.error("[usage-meter] settings store unavailable \u2014 cannot switch hit scope");
      return;
    }
    try {
      void updateSettingsStore((draft) => {
        const liveHitScope = draft.hitScope === "session" ? "session" : "today";
        draft.hitScope = liveHitScope === "session" ? "today" : "session";
      }).catch((error) => console.error("[usage-meter] failed to persist hitScope", error));
    } catch {
    }
  };
  const cycleTotalScope = () => {
    if (!updateSettingsStore) {
      console.error("[usage-meter] settings store unavailable \u2014 cannot cycle total scope");
      return;
    }
    try {
      void updateSettingsStore((draft) => {
        const liveTotalScope = TOTAL_SCOPES.includes(draft.totalScope) ? draft.totalScope : "today";
        draft.totalScope = nextTotalScope(liveTotalScope);
      }).catch((error) => console.error("[usage-meter] failed to persist totalScope", error));
    } catch {
    }
  };
  const release = () => {
  };
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
    release
  };
}

// src/stats-source.ts
import { createSignal } from "solid-js";
var ROLLING_WINDOW_MS = {
  "24h": 24 * 36e5,
  "7d": 7 * 864e5,
  "30d": 30 * 864e5
};
var STATS_FETCH_TIMEOUT_MS = 15e3;
var withFetchTimeout = async (input, call) => {
  let timeoutHandle;
  try {
    return await Promise.race([
      call(input),
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`stats fetch timed out after ${STATS_FETCH_TIMEOUT_MS}ms`)),
          STATS_FETCH_TIMEOUT_MS
        );
      })
    ]);
  } finally {
    if (timeoutHandle !== void 0) clearTimeout(timeoutHandle);
  }
};
function createStatsSource(context, totalScopeEnabled = () => "today") {
  const [todayStats, setTodayStats] = createSignal(void 0);
  const [rangeStats, setRangeStats] = createSignal({});
  let statsDay = (/* @__PURE__ */ new Date()).toDateString();
  let statsBusy = false;
  let statsTimer;
  let statsRetryTimer;
  let timezone;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
  }
  let statsMethodMissingLogged = false;
  const statsCall = () => {
    const client = context.client;
    const candidates = [client?.session?.stats, client?.experimental?.session?.stats];
    for (const c of candidates) if (typeof c === "function") return c;
    return void 0;
  };
  const localMidnight = () => {
    const d = /* @__PURE__ */ new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const scopeStartMs = (scope) => scope === "today" ? localMidnight() : Date.now() - ROLLING_WINDOW_MS[scope];
  const unwrap = (res) => res?.data ?? res;
  const fetchToday = async () => {
    if (statsBusy) return;
    const call = statsCall();
    if (!call) {
      if (!statsMethodMissingLogged) {
        statsMethodMissingLogged = true;
        console.error("[usage-meter] session stats client method unavailable (will retry)");
      }
      if (statsRetryTimer === void 0) {
        statsRetryTimer = setTimeout(() => {
          statsRetryTimer = void 0;
          void fetchToday();
        }, 3e4);
      }
      return;
    }
    statsBusy = true;
    try {
      const input = { from: localMidnight(), to: Date.now() };
      if (timezone) input.timezone = timezone;
      const data = unwrap(await withFetchTimeout(input, call));
      if (data?.tokens) setTodayStats(data);
    } catch (error) {
      console.error("[usage-meter] session stats fetch failed:", error);
    } finally {
      statsBusy = false;
    }
  };
  let rangeBusy = false;
  let pendingRangeScope;
  const fetchRange = async (scope) => {
    if (scope === "today") return;
    if (rangeBusy) {
      pendingRangeScope = scope;
      return;
    }
    const call = statsCall();
    if (!call) return;
    rangeBusy = true;
    try {
      const input = { from: scopeStartMs(scope), to: Date.now() };
      if (timezone) input.timezone = timezone;
      const data = unwrap(await withFetchTimeout(input, call));
      if (data?.tokens) setRangeStats((previous) => ({ ...previous, [scope]: data }));
    } catch (error) {
      console.error(`[usage-meter] session stats fetch (${scope}) failed:`, error);
    } finally {
      rangeBusy = false;
    }
    const deferredScope = pendingRangeScope;
    pendingRangeScope = void 0;
    if (deferredScope !== void 0) void fetchRange(deferredScope);
  };
  const totalFor = (scope) => scope === "today" ? todayStats() : rangeStats()?.[scope];
  const fetchTotals = (scopeOverride) => {
    void fetchToday();
    const activeScope = scopeOverride ?? totalScopeEnabled();
    if (activeScope !== "today") void fetchRange(activeScope);
  };
  let panelRefresh;
  const bindPanelRefresh = (refresh) => {
    panelRefresh = refresh;
  };
  const scheduleStatsRefresh = (delayMs = 1500) => {
    if (statsTimer !== void 0) return;
    statsTimer = setTimeout(() => {
      statsTimer = void 0;
      fetchTotals();
      try {
        panelRefresh?.();
      } catch {
      }
    }, delayMs);
  };
  const checkMidnightRollover = () => {
    const day = (/* @__PURE__ */ new Date()).toDateString();
    if (day !== statsDay) {
      statsDay = day;
      fetchTotals();
    }
  };
  const release = () => {
    if (statsTimer !== void 0) clearTimeout(statsTimer);
    if (statsRetryTimer !== void 0) clearTimeout(statsRetryTimer);
  };
  return {
    todayStats,
    setTodayStats,
    rangeStats,
    totalFor,
    fetchToday,
    fetchRange,
    fetchTotals,
    scheduleStatsRefresh,
    bindPanelRefresh,
    checkMidnightRollover,
    statsCall,
    localMidnight,
    scopeStartMs,
    unwrap,
    withFetchTimeout,
    timezone,
    release
  };
}

// src/format.ts
function format(ms) {
  const clamped = Math.max(0, ms);
  if (clamped < 6e4) return `${(clamped / 1e3).toFixed(1)}s`;
  const total = Math.floor(clamped / 1e3);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) {
    return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}
function estimateTokens(text) {
  const cjk = text.match(/[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/g)?.length ?? 0;
  const other = Math.max(0, text.length - cjk);
  return Math.max(1, Math.round(cjk + other / 4));
}
function fmtNum(n) {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1e6) {
    const v = n / 1e6;
    return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}M`;
  }
  if (n >= 1e3) {
    const v = n / 1e3;
    return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}k`;
  }
  return String(Math.round(n));
}
function fmtUSD(n) {
  if (!Number.isFinite(n) || n <= 0) return "";
  return n >= 0.01 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

// src/rate-model.ts
function msgTotal(m) {
  return m.exact !== void 0 ? m.exact + Math.max(0, m.est - m.refEst) : m.est;
}
function turnTotal(st) {
  let total = 0;
  for (const m of st.msgs.values()) total += msgTotal(m);
  return total;
}
function pushSample(st) {
  const t = Date.now();
  const s = st.samples;
  while (s.length > 0 && t - s[0].t > 1e4) s.shift();
  s.push({ t, tok: turnTotal(st) });
}
function liveRate(st, now) {
  const s = st.samples;
  if (s.length < 2) return void 0;
  const last = s[s.length - 1];
  if (now - last.t > 4e3) return void 0;
  let base = s[0];
  for (const cand of s) {
    if (last.t - cand.t >= 2500) {
      base = cand;
      break;
    }
  }
  const dt = (last.t - base.t) / 1e3;
  if (dt < 0.4) return void 0;
  const rate = Math.round((last.tok - base.tok) / dt);
  return rate > 0 ? rate : void 0;
}
var dataOf = (event) => event?.data ?? event?.properties ?? event;
var tsOf = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return void 0;
};
var sessionIDOf = (event) => {
  const data = dataOf(event);
  return typeof data?.sessionID === "string" && data.sessionID ? data.sessionID : void 0;
};

// src/session-metrics.ts
var BACKFILL_RETRY_INTERVAL_MS = 6e4;
function createSessionMetrics(deps) {
  const { context, calibration, scheduleStatsRefresh } = deps;
  const starts = /* @__PURE__ */ new Map();
  const lastDurations = /* @__PURE__ */ new Map();
  const lastAvgRates = /* @__PURE__ */ new Map();
  const lastExactRates = /* @__PURE__ */ new Map();
  const rates = /* @__PURE__ */ new Map();
  const newRateState = (sessionID) => ({ sessionID, msgs: /* @__PURE__ */ new Map(), samples: [], sessionVocab: false });
  const rateStateOf = (sessionID) => {
    if (!starts.has(sessionID)) return void 0;
    let st = rates.get(sessionID);
    if (!st) {
      st = newRateState(sessionID);
      rates.set(sessionID, st);
    }
    return st;
  };
  const addEst = (st, messageID, delta) => {
    if (!delta) return;
    const key = messageID ?? "_anon";
    const m = st.msgs.get(key) ?? { est: 0, refEst: 0 };
    m.est += estimateTokens(delta);
    st.msgs.set(key, m);
    pushSample(st);
  };
  const adoptExact = (st, messageID, out, force) => {
    const key = messageID ?? "_anon";
    const m = st.msgs.get(key) ?? { est: 0, refEst: 0 };
    if (force || out > msgTotal(m)) {
      calibration.learnCalibration(st.sessionID, msgTotal(m), out);
      m.exact = out;
      m.refEst = m.est;
      st.msgs.set(key, m);
    }
    pushSample(st);
  };
  const exactRateFromRecords = (sessionID, startedMs) => {
    try {
      const messages = context.data?.session?.message?.list?.(sessionID) ?? [];
      let toks = 0;
      let genMs = 0;
      for (const m of messages) {
        if (m?.type !== "assistant") continue;
        const created = tsOf(m?.time?.created);
        const completed = tsOf(m?.time?.completed);
        const out = (m?.tokens?.output ?? 0) + (m?.tokens?.reasoning ?? 0);
        if (created === void 0 || completed === void 0 || out <= 0) continue;
        if (created < startedMs - 2e3) continue;
        toks += out;
        genMs += Math.max(0, completed - created);
      }
      if (toks > 0 && genMs >= 500) {
        lastExactRates.set(sessionID, Math.round(toks / (genMs / 1e3)));
      }
    } catch {
    }
  };
  const backfillLastAttemptAt = /* @__PURE__ */ new Map();
  const backfillLastTurn = (sessionID) => {
    if (!sessionID || lastDurations.has(sessionID) || starts.has(sessionID)) {
      return;
    }
    const lastAttemptAt = backfillLastAttemptAt.get(sessionID);
    if (lastAttemptAt !== void 0 && Date.now() - lastAttemptAt < BACKFILL_RETRY_INTERVAL_MS) {
      return;
    }
    try {
      const messages = context.data?.session?.message?.list?.(sessionID) ?? [];
      let lastUserCreated;
      let lastAssistantCompleted;
      for (const message of messages) {
        if (message?.type === "user") {
          const created = tsOf(message?.time?.created);
          if (created !== void 0 && (lastUserCreated === void 0 || created > lastUserCreated)) {
            lastUserCreated = created;
          }
        } else if (message?.type === "assistant") {
          const completed = tsOf(message?.time?.completed);
          if (completed !== void 0 && (lastAssistantCompleted === void 0 || completed > lastAssistantCompleted)) {
            lastAssistantCompleted = completed;
          }
        }
      }
      if (lastUserCreated === void 0) {
        if (messages.length > 0) backfillLastAttemptAt.set(sessionID, Date.now());
        return;
      }
      if (lastAssistantCompleted === void 0 || lastAssistantCompleted <= lastUserCreated) {
        return;
      }
      let firstAssistantCreated;
      for (const message of messages) {
        if (message?.type !== "assistant") continue;
        const created = tsOf(message?.time?.created);
        if (created === void 0 || created < lastUserCreated - 2e3) continue;
        if (firstAssistantCreated === void 0 || created < firstAssistantCreated) {
          firstAssistantCreated = created;
        }
      }
      lastDurations.set(
        sessionID,
        lastAssistantCompleted - (firstAssistantCreated ?? lastUserCreated)
      );
      exactRateFromRecords(sessionID, lastUserCreated);
    } catch {
    }
  };
  const onExecutionStarted = (event) => {
    const sessionID = sessionIDOf(event);
    if (!sessionID) return;
    starts.set(sessionID, Date.now());
    rates.set(sessionID, newRateState(sessionID));
  };
  const onStepStarted = (event) => {
    const sessionID = sessionIDOf(event);
    const data = dataOf(event);
    const started = data?.started;
    if (sessionID && typeof started === "number" && !starts.has(sessionID)) {
      starts.set(sessionID, started);
      rates.set(sessionID, newRateState(sessionID));
    }
  };
  const delayedRecomputeTimers = [];
  const finishTurn = (event) => {
    const sessionID = sessionIDOf(event);
    if (!sessionID) return;
    const started = starts.get(sessionID);
    if (started !== void 0) {
      const elapsed = Date.now() - started;
      lastDurations.set(sessionID, elapsed);
      const st = rates.get(sessionID);
      const total = st ? turnTotal(st) : 0;
      if (total > 0 && elapsed > 0) {
        lastAvgRates.set(sessionID, Math.round(total / (elapsed / 1e3)));
      }
      exactRateFromRecords(sessionID, started);
      const delayedRecompute = setTimeout(() => {
        const timerIndex = delayedRecomputeTimers.indexOf(delayedRecompute);
        if (timerIndex >= 0) delayedRecomputeTimers.splice(timerIndex, 1);
        try {
          exactRateFromRecords(sessionID, started);
        } catch {
        }
      }, 1500);
      delayedRecomputeTimers.push(delayedRecompute);
    }
    starts.delete(sessionID);
    rates.delete(sessionID);
    scheduleStatsRefresh();
  };
  const onSessionDelta = (event) => {
    const data = dataOf(event);
    const sessionID = typeof data?.sessionID === "string" ? data.sessionID : void 0;
    const delta = typeof data?.delta === "string" ? data.delta : void 0;
    if (!sessionID || !delta) return;
    const st = rateStateOf(sessionID);
    if (!st) return;
    st.sessionVocab = true;
    addEst(st, data.assistantMessageID ?? data.messageID, delta);
  };
  const onStepEnded = (event) => {
    const data = dataOf(event);
    const sessionID = typeof data?.sessionID === "string" ? data.sessionID : void 0;
    const out = data?.tokens?.output;
    if (sessionID && typeof out === "number" && out > 0) {
      const st = rateStateOf(sessionID);
      if (st) {
        st.sessionVocab = true;
        adoptExact(st, data.assistantMessageID ?? data.messageID, out, false);
      }
    }
    scheduleStatsRefresh();
  };
  const onLegacyDelta = (event) => {
    const data = dataOf(event);
    const sessionID = typeof data?.sessionID === "string" ? data.sessionID : void 0;
    const delta = typeof data?.delta === "string" ? data.delta : void 0;
    if (!sessionID || !delta) return;
    const st = rateStateOf(sessionID);
    if (!st || st.sessionVocab) return;
    addEst(st, data.assistantMessageID ?? data.messageID, delta);
  };
  const onMessageUpdated = (event) => {
    const data = dataOf(event);
    const info = data?.info;
    if (info?.role !== "assistant" || typeof info?.tokens?.output !== "number") return;
    const sessionID = typeof data?.sessionID === "string" ? data.sessionID : void 0;
    if (!sessionID) return;
    if (info.model) calibration.rememberSessionModel(sessionID, info.model);
    const t = info.time;
    const created = tsOf(t?.created);
    const completed = tsOf(t?.completed);
    if (created !== void 0 && completed !== void 0) {
      const dur = (completed - created) / 1e3;
      const toks = (info.tokens.output ?? 0) + (info.tokens.reasoning ?? 0);
      if (dur >= 0.5 && toks > 0) lastExactRates.set(sessionID, Math.round(toks / dur));
    }
    const st = rateStateOf(sessionID);
    if (!st) return;
    const out = info.tokens.output;
    if (out > 0) adoptExact(st, info.id, out, info.time?.completed !== void 0);
  };
  const release = () => {
    for (const pendingTimer of delayedRecomputeTimers) clearTimeout(pendingTimer);
    delayedRecomputeTimers.length = 0;
  };
  return {
    onExecutionStarted,
    onStepStarted,
    onSessionDelta,
    onStepEnded,
    onLegacyDelta,
    onMessageUpdated,
    finishTurn,
    backfillLastTurn,
    release,
    starts,
    lastDurations,
    lastAvgRates,
    lastExactRates,
    rates,
    rateStateOf
  };
}

// src/panel-content.ts
import { createSignal as createSignal2 } from "solid-js";

// src/hit-rate.ts
var sessionHitRatio = (cacheRead, input, cacheWrite) => {
  const denominator = input + cacheRead + cacheWrite;
  return denominator > 0 ? cacheRead / denominator : void 0;
};
var dailyHitRatio = (cacheRead, input) => {
  const denominator = cacheRead + input;
  return denominator > 0 ? cacheRead / denominator : void 0;
};

// src/panel-content.ts
var PANEL_NAME = "usage-meter.stats";
function createPanelContent(deps) {
  const { context, now } = deps;
  const { starts, lastDurations, lastAvgRates, lastExactRates, rates } = deps.sessionMetrics;
  const { setTodayStats, statsCall, totalFor, localMidnight, unwrap, timezone, withFetchTimeout: withFetchTimeout2 } = deps.statsSource;
  const { totalScopeEnabled } = deps.settings;
  const { calibOf } = deps.calibration;
  const [detail, setDetail] = createSignal2(void 0);
  const EMPTY_TOKENS = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
  const CTX_WARN_PCT = 80;
  const sumTokens = (t) => (t?.input ?? 0) + (t?.output ?? 0) + (t?.reasoning ?? 0) + (t?.cache?.read ?? 0) + (t?.cache?.write ?? 0);
  const ctxModelLimit = (message) => {
    try {
      const models = context.data?.location?.model?.list?.(context.location) ?? [];
      const m = models.find((c) => c?.providerID === message?.model?.providerID && (c?.modelID === message?.model?.id || c?.id === message?.model?.id));
      const limit = m?.limit?.context;
      return typeof limit === "number" && limit > 0 ? limit : void 0;
    } catch {
      return void 0;
    }
  };
  const lastAssistant = (sessionID) => {
    try {
      const messages = context.data?.session?.message?.list?.(sessionID) ?? [];
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m?.type === "assistant" && (m?.tokens?.output ?? 0) > 0) return m;
      }
    } catch {
    }
    return void 0;
  };
  const ctxPercent = (sessionID) => {
    const m = lastAssistant(sessionID);
    if (!m) return void 0;
    const limit = ctxModelLimit(m);
    if (!limit) return void 0;
    const tokens = sumTokens(m.tokens);
    const pct = Math.round(tokens / limit * 100);
    return { pct, warn: pct >= CTX_WARN_PCT };
  };
  const descendantSessions = (rootID) => {
    try {
      const all = context.data?.session?.list?.() ?? [];
      const found = [];
      const seen = /* @__PURE__ */ new Set([rootID]);
      const queue = [rootID];
      while (queue.length > 0 && found.length < 200) {
        const parentID = queue.shift();
        for (const s of all) {
          if (s?.parentID !== parentID || seen.has(s.id)) continue;
          seen.add(s.id);
          found.push(s);
          queue.push(s.id);
        }
      }
      return found;
    } catch {
      return [];
    }
  };
  const syncedChildren = /* @__PURE__ */ new Set();
  const sessionUsageLines = (sessionID) => {
    const lines = [];
    try {
      const m = lastAssistant(sessionID);
      if (m) {
        const t = m.tokens ?? EMPTY_TOKENS;
        const limit = ctxModelLimit(m);
        lines.push("\u2500\u2500 \u5F53\u524D\u7A97\u53E3(\u6700\u540E\u4E00\u6B21\u8BF7\u6C42) \u2500\u2500");
        lines.push(`  in ${fmtNum(t.input ?? 0)}  out ${fmtNum(t.output ?? 0)}  reasoning ${fmtNum(t.reasoning ?? 0)}`);
        lines.push(`  cache R ${fmtNum(t.cache?.read ?? 0)}  W ${fmtNum(t.cache?.write ?? 0)}`);
        if (limit) {
          const pct = Math.round(sumTokens(t) / limit * 100);
          lines.push(`  \u5360\u7528 ${fmtNum(sumTokens(t))} / ${fmtNum(limit)} (${pct}%)${pct >= CTX_WARN_PCT ? "  \u25B2 \u63A5\u8FD1\u538B\u7F29\u9608\u503C" : ""}`);
        } else {
          lines.push(`  \u5360\u7528 ${fmtNum(sumTokens(t))}(\u6A21\u578B\u7A97\u53E3\u4E0A\u9650\u672A\u77E5)`);
        }
        lines.push("");
      }
      const session = context.data?.session?.get?.(sessionID);
      const agg = session?.tokens;
      if (agg && sumTokens(agg) > 0) {
        let turns = 0;
        let msgTokens = 0;
        try {
          const messages = context.data?.session?.message?.list?.(sessionID) ?? [];
          const asst = messages.filter((x) => x?.type === "assistant");
          turns = asst.length;
          for (const a of asst) msgTokens += sumTokens(a?.tokens);
        } catch {
        }
        const partial = sumTokens(agg) > msgTokens + 10;
        const input = agg.input ?? 0;
        const output = agg.output ?? 0;
        const reasoning = agg.reasoning ?? 0;
        const read = agg.cache?.read ?? 0;
        const write = agg.cache?.write ?? 0;
        const hitRatio = sessionHitRatio(read, input, write);
        const hit = hitRatio !== void 0 ? Math.round(hitRatio * 100) : void 0;
        const cost = fmtUSD(session?.cost ?? 0);
        lines.push("\u2500\u2500 \u672C\u4F1A\u8BDD\u7D2F\u8BA1 \u2500\u2500");
        lines.push(`  ${turns}${partial ? "+" : ""} \u8F6E \xB7 in ${fmtNum(input)}  out ${fmtNum(output)}  reasoning ${fmtNum(reasoning)}`);
        lines.push(`  cache R ${fmtNum(read)}  W ${fmtNum(write)} \xB7 \u8FC7\u6D41 ${fmtNum(sumTokens(agg))}${hit !== void 0 ? `  \u547D\u4E2D ${hit}%` : ""}${cost ? ` \xB7 ${cost}` : ""}`);
        const children = descendantSessions(sessionID);
        for (const c of children) {
          if (!c?.id || syncedChildren.has(c.id)) continue;
          syncedChildren.add(c.id);
          try {
            const syncResult = context.data?.session?.sync?.(c.id);
            if (syncResult && typeof syncResult.then === "function") {
              void syncResult.catch(() => {
                syncedChildren.delete(c.id);
              });
            }
          } catch {
            syncedChildren.delete(c.id);
          }
        }
        if (children.length > 0) {
          let ci = 0, co = 0, cr = 0, cc = 0, cw = 0, ccost = 0;
          let anyTok = false;
          for (const c of children) {
            const ct = c?.tokens;
            if (!ct) continue;
            if (sumTokens(ct) > 0) anyTok = true;
            ci += ct.input ?? 0;
            co += ct.output ?? 0;
            cr += ct.reasoning ?? 0;
            cc += ct.cache?.read ?? 0;
            cw += ct.cache?.write ?? 0;
            ccost += c?.cost ?? 0;
          }
          if (anyTok) {
            const childrenHitRatio = sessionHitRatio(cc, ci, cw);
            const chit = childrenHitRatio !== void 0 ? Math.round(childrenHitRatio * 100) : void 0;
            const cCost = fmtUSD(ccost);
            lines.push("");
            lines.push(`\u2500\u2500 \u5B50\u4EE3\u7406(${children.length} \u4E2A\u4F1A\u8BDD) \u2500\u2500`);
            lines.push(`  in ${fmtNum(ci)}  out ${fmtNum(co)}  reasoning ${fmtNum(cr)}`);
            lines.push(`  cache R ${fmtNum(cc)}  W ${fmtNum(cw)} \xB7 \u8FC7\u6D41 ${fmtNum(ci + co + cr + cc + cw)}${chit !== void 0 ? `  \u547D\u4E2D ${chit}%` : ""}${cCost ? ` \xB7 ${cCost}` : ""}`);
            lines.push("");
            const sCost = fmtUSD((session?.cost ?? 0) + ccost);
            lines.push(`  \u4F1A\u8BDD+\u5B50\u4EE3\u7406\u5408\u8BA1:\u8FC7\u6D41 ${fmtNum(sumTokens(agg) + ci + co + cr + cc + cw)}${sCost ? ` \xB7 ${sCost}` : ""}`);
          }
        }
        lines.push("");
      }
    } catch {
    }
    return lines;
  };
  const sessionLines = (sessionID) => {
    if (!sessionID) return [];
    const lines = ["\u2500\u2500 \u5F53\u524D\u4F1A\u8BDD \u2500\u2500"];
    let running = false;
    try {
      running = context.data?.session?.status?.(sessionID) === "running";
    } catch {
    }
    const started = starts.get(sessionID);
    const last = lastDurations.get(sessionID);
    const currentTime = now();
    if (running && started !== void 0) {
      let line = `  \u23F1 ${format(currentTime - started)}`;
      const rate = rates.get(sessionID);
      const tps = rate ? liveRate(rate, currentTime) : void 0;
      if (tps !== void 0) line += `   \u26A1 ${Math.round(tps * calibOf(sessionID))} tok/s`;
      lines.push(line);
    } else if (running) {
      lines.push("  \u23F3");
    } else if (last !== void 0) {
      let line = `  \u{1F3C1} ${format(last)}`;
      const exact = lastExactRates.get(sessionID);
      if (exact !== void 0) {
        line += `   \u26A1 ${exact} tok/s`;
      } else {
        const avg = lastAvgRates.get(sessionID);
        if (avg !== void 0) line += `   \u26A1 ${avg} tok/s avg`;
      }
      lines.push(line);
    } else {
      lines.push("  (\u7A7A\u95F2)");
    }
    const totalScope = totalScopeEnabled();
    const scopeStats = totalFor(totalScope);
    if (scopeStats) {
      const scopeTokens = scopeStats?.tokens;
      const total = (scopeTokens?.input ?? 0) + (scopeTokens?.output ?? 0) + (scopeTokens?.reasoning ?? 0);
      if (total > 0) lines.push(`  \u03A3 ${TOTAL_SCOPE_LABELS[totalScope]} ${fmtNum(total)}`);
    }
    lines.push(...sessionUsageLines(sessionID));
    lines.push("");
    return lines;
  };
  const detailLines = (st) => {
    const today = st?.today;
    const all = st?.all;
    const lines = [];
    const cacheHit = (tk2) => {
      const ratio = dailyHitRatio(tk2?.cache?.read ?? 0, tk2?.input ?? 0);
      return ratio !== void 0 ? Math.round(ratio * 100) : void 0;
    };
    const modelRow = (u) => {
      const name = `${u.model?.providerID ?? "?"}/${u.model?.id ?? "?"}`.slice(0, 36);
      const cost = fmtUSD(u.cost ?? 0);
      return `  ${name.padEnd(36)} ${String(u.steps ?? 0).padStart(5)}\u6B65  in ${fmtNum(u.tokens?.input ?? 0).padStart(6)}  out ${fmtNum(u.tokens?.output ?? 0).padStart(6)}${cost ? `  ${cost}` : ""}`;
    };
    lines.push("\u2500\u2500 \u4ECA\u65E5 \u2500\u2500");
    const models = Array.isArray(today?.models) ? [...today.models] : [];
    models.sort((a, b) => (b.tokens?.output ?? 0) - (a.tokens?.output ?? 0));
    for (const u of models.slice(0, 12)) lines.push(modelRow(u));
    if (models.length > 12) lines.push(`  \u2026\u53E6\u6709 ${models.length - 12} \u4E2A\u6A21\u578B`);
    const tk = today?.tokens ?? {};
    const todayCost = fmtUSD(today?.cost ?? 0);
    const todayHit = cacheHit(tk);
    lines.push(
      `  \u5408\u8BA1 ${String(today?.steps ?? 0)}\u6B65 \xB7 in ${fmtNum(tk.input ?? 0)}  out ${fmtNum(tk.output ?? 0)}  reasoning ${fmtNum(tk.reasoning ?? 0)} \xB7 cache R ${fmtNum(tk.cache?.read ?? 0)}  W ${fmtNum(tk.cache?.write ?? 0)}${todayHit !== void 0 ? `  \u547D\u4E2D ${todayHit}%` : ""}${todayCost ? ` \xB7 ${todayCost}` : ""}`
    );
    lines.push(
      `  \u542B\u7F13\u5B58\u603B\u91CF ${fmtNum(sumTokens(tk))}(\u542B cache R/W \xB7 \u03A3/\u{1F4CA} \u53E3\u5F84\u4E0D\u542B cache)`
    );
    lines.push("");
    lines.push("\u2500\u2500 \u8FD1 7 \u65E5(steps) \u2500\u2500");
    const activity = Array.isArray(all?.activity) ? all.activity : [];
    const week = activity.slice(-7);
    const maxSteps = Math.max(1, ...week.map((a) => a?.steps ?? 0));
    for (const a of week) {
      const steps = a?.steps ?? 0;
      const bar = "\u2588".repeat(Math.max(1, Math.round(steps / maxSteps * 18)));
      lines.push(`  ${String(a?.date ?? "").padEnd(12)} ${bar.padEnd(20)} ${String(steps)}`);
    }
    if (week.length === 0) lines.push("  (\u6682\u65E0\u6570\u636E)");
    lines.push("");
    lines.push("\u2500\u2500 \u7D2F\u8BA1 \u2500\u2500");
    const atk = all?.tokens ?? {};
    const allHit = cacheHit(atk);
    lines.push(
      `  tokens  in ${fmtNum(atk.input ?? 0)}  out ${fmtNum(atk.output ?? 0)}  reasoning ${fmtNum(atk.reasoning ?? 0)}`
    );
    lines.push(
      `  cache  R ${fmtNum(atk.cache?.read ?? 0)}  W ${fmtNum(atk.cache?.write ?? 0)}${allHit !== void 0 ? `  \u547D\u4E2D ${allHit}%` : ""}`
    );
    const allCost = fmtUSD(all?.cost ?? 0);
    lines.push(
      `  ${String(all?.steps ?? 0)}\u6B65 \xB7 ${String(all?.sessions ?? 0)}\u4F1A\u8BDD \xB7 \u6D3B\u8DC3 ${String(all?.activeDays ?? 0)}\u5929 \xB7 \u8FDE\u7EED ${String(all?.streak ?? 0)}\u5929${allCost ? ` \xB7 ${allCost}` : ""}`
    );
    const top = Array.isArray(all?.models) ? [...all.models] : [];
    top.sort((a, b) => (b.tokens?.output ?? 0) - (a.tokens?.output ?? 0));
    const topModels = top.filter((u) => (u.tokens?.output ?? 0) > 0).slice(0, 5);
    if (topModels.length > 0) {
      lines.push("");
      lines.push("\u2500\u2500 \u7D2F\u8BA1 Top \u6A21\u578B(\u6309\u8F93\u51FA) \u2500\u2500");
      for (const u of topModels) lines.push(modelRow(u));
    }
    return lines;
  };
  const ensureDetail = async () => {
    const call = statsCall();
    if (!call) {
      setDetail({ error: "stats client method unavailable(OpenCode \u7248\u672C\u8FC7\u65E7?)" });
      return;
    }
    try {
      const baseInput = timezone ? { timezone } : {};
      const [todayRes, allRes] = await Promise.all([
        // v0.6.4: numbers, not strings — the SDK input schema is `number`.
        withFetchTimeout2({ ...baseInput, from: localMidnight(), to: Date.now() }, call),
        withFetchTimeout2(baseInput, call)
      ]);
      const today = unwrap(todayRes);
      const all = unwrap(allRes);
      if (!today?.tokens || !all?.tokens) throw new Error("\u7A7A\u54CD\u5E94");
      setTodayStats(today);
      setDetail({ today, all });
    } catch (error) {
      setDetail({ error: String(error?.message ?? error) });
    }
  };
  return {
    detail,
    setDetail,
    sumTokens,
    ctxModelLimit,
    lastAssistant,
    ctxPercent,
    descendantSessions,
    sessionUsageLines,
    sessionLines,
    detailLines,
    ensureDetail
  };
}

// src/components/stats-panel.tsx
import { createMemo } from "solid-js";
import { jsx } from "@opentui/solid/jsx-runtime";
function createStatsPanel(deps) {
  const { context } = deps;
  const { sessionLines, detail, detailLines, ensureDetail, setDetail } = deps.panelContent;
  const StatsBody = (props) => {
    const lines = createMemo(() => {
      const out = [...sessionLines(props.sessionID)];
      const st = detail();
      if (!st) {
        out.push("\u7EDF\u8BA1\u52A0\u8F7D\u4E2D\u2026");
        return out;
      }
      if (st.error) {
        out.push(`\u7EDF\u8BA1\u52A0\u8F7D\u5931\u8D25:${st.error}`);
        return out;
      }
      out.push(...detailLines(st));
      return out;
    });
    const base = context.theme?.text?.base;
    return /* @__PURE__ */ jsx("text", { fg: base, children: () => lines().join("\n") });
  };
  const runTokensCommand = async () => {
    const panelAPI = context.ui?.panel;
    try {
      const current = panelAPI?.current?.();
      if (current === PANEL_NAME || current?.name === PANEL_NAME) {
        panelAPI?.close?.();
        return;
      }
    } catch {
    }
    let opened = true;
    try {
      opened = panelAPI?.open?.(PANEL_NAME);
    } catch {
      opened = false;
    }
    if (opened !== true) {
      let sid;
      try {
        const route = context.ui?.router?.current?.();
        sid = route?.type === "session" ? route.sessionID ?? route.params?.sessionID : route?.params?.sessionID;
      } catch {
      }
      try {
        context.ui.dialog.set({ size: "large", centered: true });
      } catch {
      }
      setDetail(void 0);
      try {
        context.ui.dialog.show(() => /* @__PURE__ */ jsx(StatsBody, { sessionID: sid }), () => {
        });
      } catch (error) {
        console.error("[usage-meter] stats dialog fallback failed:", error);
      }
    } else {
      setDetail(void 0);
    }
    void ensureDetail();
  };
  let fullscreenLayerDispose;
  let currentFullscreenPanel;
  const StatsPanel = (props) => {
    currentFullscreenPanel = props.panel;
    if (fullscreenLayerDispose === void 0) {
      try {
        fullscreenLayerDispose = context.keymap?.layer?.(() => ({
          commands: [
            {
              id: "usage-meter.stats.fullscreen",
              title: "\u7EDF\u8BA1\u9762\u677F\u5168\u5C4F",
              bind: "f",
              run: () => {
                try {
                  currentFullscreenPanel?.toggleFullscreen?.();
                } catch {
                }
              }
            }
          ]
        }));
      } catch {
        fullscreenLayerDispose = null;
      }
    }
    return /* @__PURE__ */ jsx(StatsBody, { sessionID: props.panel?.sessionID });
  };
  const disposeFullscreenLayer = () => {
    if (typeof fullscreenLayerDispose === "function") {
      try {
        fullscreenLayerDispose();
      } catch {
      }
    } else if (fullscreenLayerDispose && typeof fullscreenLayerDispose.dispose === "function") {
      try {
        fullscreenLayerDispose.dispose();
      } catch {
      }
    }
    fullscreenLayerDispose = void 0;
  };
  return { StatsBody, StatsPanel, runTokensCommand, disposeFullscreenLayer };
}

// src/components/settings-dialog.tsx
import { createMemo as createMemo2 } from "solid-js";
import { jsx as jsx2 } from "@opentui/solid/jsx-runtime";
function createSettingsDialog(deps) {
  const { context, fetchTotals, now } = deps;
  const {
    hitScopeEnabled,
    totalScopeEnabled,
    footerSigmaEnabled,
    footerHitEnabled,
    sidebarMetricsEnabled,
    toggleSettingsFlag,
    toggleHitScope,
    cycleTotalScope
  } = deps.settings;
  let keymapLayerDispose;
  const SettingsBody = () => {
    if (keymapLayerDispose === void 0) {
      try {
        keymapLayerDispose = context.keymap?.layer?.(() => ({
          commands: [
            {
              id: "usage-meter.settings.toggle-hit",
              title: "\u7528\u91CF\u8BBE\u7F6E:\u5207\u6362 hit \u7EF4\u5EA6",
              bind: "d",
              run: () => toggleHitScope()
            },
            {
              id: "usage-meter.settings.cycle-total-scope",
              title: "\u7528\u91CF\u8BBE\u7F6E:\u03A3/\u{1F4CA} \u603B\u8017\u7EF4\u5EA6",
              bind: "s",
              run: () => {
                const upcomingScope = nextTotalScope(totalScopeEnabled());
                cycleTotalScope();
                try {
                  fetchTotals(upcomingScope);
                } catch {
                }
              }
            },
            {
              id: "usage-meter.settings.toggle-footer-sigma",
              title: "\u7528\u91CF\u8BBE\u7F6E:footer \u03A3 \u6BB5\u5F00\u5173",
              bind: "f",
              run: () => toggleSettingsFlag("footerSigma", footerSigmaEnabled())
            },
            {
              id: "usage-meter.settings.toggle-footer-hit",
              title: "\u7528\u91CF\u8BBE\u7F6E:footer hit \u6BB5\u5F00\u5173",
              bind: "h",
              run: () => toggleSettingsFlag("footerHit", footerHitEnabled())
            },
            {
              id: "usage-meter.settings.toggle-sidebar",
              title: "\u7528\u91CF\u8BBE\u7F6E:\u53F3\u680F\u6307\u6807\u5757\u5F00\u5173",
              bind: "b",
              run: () => toggleSettingsFlag("sidebarMetrics", sidebarMetricsEnabled())
            }
          ]
        }));
      } catch {
        keymapLayerDispose = null;
      }
    }
    const lines = createMemo2(() => {
      now();
      const onOff = (enabled) => enabled ? "\u5F00" : "\u5173";
      const hitScopeLabel = hitScopeEnabled() === "session" ? "\u5F53\u524D\u4F1A\u8BDD(hit\xB7s,\u4E25\u683C\u53E3\u5F84 read \xF7 (input+read+write))" : "\u4ECA\u65E5\u6C47\u603B(hit,\u5168 session \u65E5\u7EA7,read \xF7 (read+input))";
      const totalScope = totalScopeEnabled();
      const totalScopeLabel = `${TOTAL_SCOPE_LABELS[totalScope]}(\u4ECA\u65E5=\u672C\u5730\u96F6\u70B9\u8D77,\u5176\u4F59\u4E3A\u6EDA\u52A8\u7A97\u53E3)`;
      return [
        "\u7528\u91CF\u8BBE\u7F6E",
        "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
        `hit \u7EF4\u5EA6:${hitScopeLabel}`,
        `\u03A3/\u{1F4CA} \u603B\u8017\u7EF4\u5EA6:${totalScopeLabel}`,
        `footer \u03A3 \u6BB5:${onOff(footerSigmaEnabled())}`,
        `footer hit \u6BB5:${onOff(footerHitEnabled())}`,
        `\u53F3\u680F\u6307\u6807\u5757:${onOff(sidebarMetricsEnabled())}`,
        "",
        "d hit \u7EF4\u5EA6 \xB7 s \u03A3 \u7EF4\u5EA6 \xB7 f footer \u03A3 \xB7 h footer hit \xB7 b \u53F3\u680F\u5757 \xB7 Esc \u5173\u95ED",
        "(footer \u9ED8\u8BA4\u53EA\u663E\u793A \u23F1 \u4E0E \u26A1,\u5176\u4F59\u6BB5\u6309\u9700\u5F00\u542F;\u9009\u62E9\u81EA\u52A8\u6301\u4E45\u5316)"
      ];
    });
    return /* @__PURE__ */ jsx2("text", { fg: context.theme?.text?.base, children: () => lines().join("\n") });
  };
  const disposeKeymapLayer = () => {
    if (typeof keymapLayerDispose === "function") {
      try {
        keymapLayerDispose();
      } catch {
      }
    } else if (keymapLayerDispose && typeof keymapLayerDispose.dispose === "function") {
      try {
        keymapLayerDispose.dispose();
      } catch {
      }
    }
    keymapLayerDispose = void 0;
  };
  return { SettingsBody, disposeKeymapLayer };
}

// src/components/sidebar-metrics.tsx
import { createMemo as createMemo3 } from "solid-js";
import { jsx as jsx3, jsxs } from "@opentui/solid/jsx-runtime";
function createSidebarMetrics(deps) {
  const { context, now } = deps;
  const { starts, lastDurations, lastAvgRates, lastExactRates, rates, backfillLastTurn } = deps.sessionMetrics;
  const {
    sidebarMetricsEnabled,
    statsBlockCollapsed,
    hitScopeEnabled,
    totalScopeEnabled,
    toggleSettingsFlag
  } = deps.settings;
  const { todayStats, totalFor } = deps.statsSource;
  const { calibOf } = deps.calibration;
  const SidebarMetrics = (props) => {
    if (!sidebarMetricsEnabled()) return null;
    const sessionID = props.sessionID;
    backfillLastTurn(sessionID);
    const blockState = createMemo3(() => {
      const currentTime = now();
      const collapsed = statsBlockCollapsed();
      let metricText = null;
      if (!collapsed) {
        let running = false;
        try {
          running = context.data?.session?.status?.(sessionID) === "running";
        } catch {
        }
        const started = starts.get(sessionID);
        const last = lastDurations.get(sessionID);
        const metricLines = [];
        if (running && started !== void 0) {
          metricLines.push(`\u23F1 ${format(currentTime - started)}`);
          const rate = rates.get(sessionID);
          const liveTokPerSec = rate ? liveRate(rate, currentTime) : void 0;
          if (liveTokPerSec !== void 0) {
            metricLines.push(`\u26A1 ${Math.round(liveTokPerSec * calibOf(sessionID))} tok/s`);
          }
        } else if (running) {
          metricLines.push("\u23F3");
        } else if (last !== void 0) {
          metricLines.push(`\u{1F3C1} ${format(last)}`);
          const exact = lastExactRates.get(sessionID);
          const avgRate = lastAvgRates.get(sessionID);
          if (exact !== void 0) metricLines.push(`\u26A1 ${exact} tok/s`);
          else if (avgRate !== void 0) metricLines.push(`\u26A1 ${avgRate} tok/s avg`);
        }
        const stats = todayStats();
        const hitScope = hitScopeEnabled();
        const totalScope = totalScopeEnabled();
        const scopeStats = totalFor(totalScope);
        if (scopeStats) {
          const scopeTokens = scopeStats?.tokens;
          const freshTokensTotal = (scopeTokens?.input ?? 0) + (scopeTokens?.output ?? 0) + (scopeTokens?.reasoning ?? 0);
          const cacheInclusiveTotal = freshTokensTotal + (scopeTokens?.cache?.read ?? 0) + (scopeTokens?.cache?.write ?? 0);
          if (freshTokensTotal > 0) {
            metricLines.push(
              cacheInclusiveTotal > freshTokensTotal ? `\u{1F4CA} ${fmtNum(freshTokensTotal)} / ${fmtNum(cacheInclusiveTotal)} (${totalScope})` : `\u{1F4CA} ${fmtNum(freshTokensTotal)} (${totalScope})`
            );
          }
        }
        if (hitScope === "session") {
          try {
            const sessionTokens = context.data?.session?.get?.(sessionID)?.tokens;
            const sessionRatio = sessionHitRatio(
              sessionTokens?.cache?.read ?? 0,
              sessionTokens?.input ?? 0,
              sessionTokens?.cache?.write ?? 0
            );
            if (sessionRatio !== void 0)
              metricLines.push(`\u{1F3AF} ${(sessionRatio * 100).toFixed(1)}% (session)`);
          } catch {
          }
        } else if (stats) {
          const dailyRatio = dailyHitRatio(stats?.tokens?.cache?.read ?? 0, stats?.tokens?.input ?? 0);
          if (dailyRatio !== void 0)
            metricLines.push(`\u{1F3AF} ${(dailyRatio * 100).toFixed(1)}% (today)`);
        }
        metricText = metricLines.length > 0 ? metricLines.join("\n") : null;
      }
      return { collapsed, metricText };
    });
    const initialState = blockState();
    if (!initialState.collapsed && initialState.metricText === null) return null;
    const base = context.theme?.text?.base;
    const muted = context.theme?.text?.muted;
    return /* @__PURE__ */ jsxs("box", { flexDirection: "column", children: [
      /* @__PURE__ */ jsx3(
        "box",
        {
          flexDirection: "row",
          width: "100%",
          onMouseUp: () => {
            toggleSettingsFlag("statsBlockCollapsed", statsBlockCollapsed());
          },
          children: /* @__PURE__ */ jsx3("text", { fg: base, selectable: false, children: () => {
            return `${blockState().collapsed ? "\u25B8" : "\u25BC"} Stats`;
          } })
        }
      ),
      () => {
        return blockState().collapsed ? null : /* @__PURE__ */ jsx3("text", { fg: muted, children: () => blockState().metricText });
      }
    ] });
  };
  return { SidebarMetrics };
}

// src/components/footer-status.tsx
import { createMemo as createMemo4 } from "solid-js";

// src/footer-runs.ts
var coalesceFooterRuns = (segments) => {
  const runs = [];
  for (const segment of segments) {
    const lastRun = runs[runs.length - 1];
    if (lastRun !== void 0 && lastRun.dim === segment.dim) {
      lastRun.text += `   ${segment.text}`;
    } else {
      runs.push({
        text: runs.length > 0 ? `   ${segment.text}` : segment.text,
        dim: segment.dim
      });
    }
  }
  return runs;
};

// src/components/footer-status.tsx
import { jsx as jsx4 } from "@opentui/solid/jsx-runtime";
var DIM_TEXT_ATTRIBUTE = 1 << 1;
function createFooterStatus(deps) {
  const { context, now } = deps;
  const { starts, lastDurations, lastAvgRates, lastExactRates, rates, backfillLastTurn } = deps.sessionMetrics;
  const { hitScopeEnabled, totalScopeEnabled, footerHitEnabled, footerSigmaEnabled } = deps.settings;
  const { todayStats, totalFor } = deps.statsSource;
  const { calibOf } = deps.calibration;
  const lastLiveRates = /* @__PURE__ */ new Map();
  const FooterStatus = (componentProps) => {
    const slotProps = componentProps.slotProps;
    let sessionID;
    try {
      const route = context.ui?.router?.current?.();
      sessionID = slotProps?.sessionID ?? (route?.type === "session" ? route.sessionID ?? route.params?.sessionID : route?.params?.sessionID);
    } catch {
    }
    if (!sessionID) return null;
    backfillLastTurn(sessionID);
    const statusText = createMemo4(() => {
      const currentTime = now();
      let running = false;
      try {
        running = context.data?.session?.status?.(sessionID) === "running";
      } catch {
      }
      const started = starts.get(sessionID);
      const last = lastDurations.get(sessionID);
      const parts = [];
      if (running && started !== void 0) {
        parts.push({ text: `\u23F1 ${format(currentTime - started)}` });
        const rate = rates.get(sessionID);
        const tps = rate ? liveRate(rate, currentTime) : void 0;
        if (tps !== void 0) {
          const tokensPerSecond = Math.round(tps * calibOf(sessionID));
          lastLiveRates.set(sessionID, { turnStartedAt: started, tokensPerSecond });
          parts.push({ text: `\u26A1 ${tokensPerSecond} tok/s` });
        } else {
          const memory = lastLiveRates.get(sessionID);
          if (memory !== void 0 && memory.turnStartedAt === started) {
            parts.push({ text: `\u26A1 ${memory.tokensPerSecond} tok/s`, dim: true });
          }
        }
      } else if (running) {
        parts.push({ text: `\u23F3` });
      } else if (last !== void 0) {
        parts.push({ text: `\u{1F3C1} ${format(last)}` });
        const exact = lastExactRates.get(sessionID);
        if (exact !== void 0) {
          parts.push({ text: `\u26A1 ${exact} tok/s` });
        } else {
          const avg = lastAvgRates.get(sessionID);
          if (avg !== void 0) parts.push({ text: `\u26A1 ${avg} tok/s avg` });
        }
      }
      const totalScope = totalScopeEnabled();
      const scopeStats = totalFor(totalScope);
      if (footerSigmaEnabled() && scopeStats) {
        const scopeTokens = scopeStats?.tokens;
        const scopeTotal = (scopeTokens?.input ?? 0) + (scopeTokens?.output ?? 0) + (scopeTokens?.reasoning ?? 0);
        if (scopeTotal > 0) {
          parts.push({
            text: `\u03A3 ${fmtNum(scopeTotal)}${totalScope === "today" ? "" : ` (${totalScope})`}`
          });
        }
      }
      const hitScope = hitScopeEnabled();
      const showHitInFooter = footerHitEnabled();
      if (showHitInFooter && hitScope === "session") {
        try {
          const sessionTokens = context.data?.session?.get?.(sessionID)?.tokens;
          const sessionRatio = sessionHitRatio(
            sessionTokens?.cache?.read ?? 0,
            sessionTokens?.input ?? 0,
            sessionTokens?.cache?.write ?? 0
          );
          if (sessionRatio !== void 0)
            parts.push({ text: `hit\xB7s ${(sessionRatio * 100).toFixed(1)}%` });
        } catch {
        }
      }
      const stats = todayStats();
      if (stats) {
        const todayTokens = stats?.tokens;
        if (showHitInFooter && hitScope !== "session") {
          const dailyRatio = dailyHitRatio(todayTokens?.cache?.read ?? 0, todayTokens?.input ?? 0);
          if (dailyRatio !== void 0) parts.push({ text: `hit ${(dailyRatio * 100).toFixed(1)}%` });
        }
      }
      return parts.length > 0 ? parts : null;
    });
    if (statusText() === null) return null;
    const muted = context.theme?.text?.muted;
    return /* @__PURE__ */ jsx4("box", { flexDirection: "row", children: () => {
      const segments = statusText();
      if (!segments) return null;
      const runs = coalesceFooterRuns(segments);
      return runs.map((run) => /* @__PURE__ */ jsx4("text", { fg: muted, attributes: run.dim ? DIM_TEXT_ATTRIBUTE : 0, children: run.text }));
    } });
  };
  return { FooterStatus };
}

// src/reactive-mount.ts
import { createElement, insert, setProp } from "@opentui/solid";
function mountReactiveRoot(render, verticalLayout) {
  const box = createElement("box");
  if (verticalLayout) {
    setProp(box, "width", "100%");
    setProp(box, "flexDirection", "column");
  }
  insert(box, render);
  return {
    root: box,
    dispose: () => {
    }
  };
}
function createReactiveSlotMount(verticalLayout) {
  let current;
  return {
    swap(render) {
      current = mountReactiveRoot(render, verticalLayout);
      return current.root;
    },
    release() {
      current = void 0;
    }
  };
}

// src/tui.tsx
import { jsx as jsx5 } from "@opentui/solid/jsx-runtime";
var tui_default = Plugin.define({
  id: "usage-meter",
  setup(context) {
    const [now, setNow] = createSignal3(Date.now());
    const calibration = createCalibration(context);
    const settings = createSettings(context);
    const statsSource = createStatsSource(context, settings.totalScopeEnabled);
    const sessionMetrics = createSessionMetrics({
      context,
      calibration,
      scheduleStatsRefresh: statsSource.scheduleStatsRefresh
    });
    const panelContent = createPanelContent({
      context,
      sessionMetrics,
      settings,
      statsSource,
      calibration,
      now
    });
    const statsPanel = createStatsPanel({ context, panelContent });
    const settingsDialog = createSettingsDialog({
      context,
      settings,
      fetchTotals: statsSource.fetchTotals,
      now
    });
    const sidebarMetrics = createSidebarMetrics({
      context,
      sessionMetrics,
      settings,
      statsSource,
      calibration,
      now
    });
    const footerStatus = createFooterStatus({
      context,
      sessionMetrics,
      settings,
      statsSource,
      calibration,
      now
    });
    statsSource.bindPanelRefresh(() => {
      const current = context.ui?.panel?.current?.();
      if (current === PANEL_NAME || current?.name === PANEL_NAME) void panelContent.ensureDetail();
    });
    const timer = setInterval(() => {
      try {
        setNow(Date.now());
        statsSource.checkMidnightRollover();
        try {
          if (typeof context.renderer?.requestRender === "function") {
            context.renderer.requestRender();
          }
        } catch {
        }
      } catch {
      }
    }, 500);
    const subs = [];
    const listen = (type, handler) => {
      try {
        subs.push(context.data.on(type, handler));
      } catch (error) {
        console.error(`[usage-meter] ${type} subscription failed:`, error);
      }
    };
    const { StatsPanel, runTokensCommand } = statsPanel;
    const { SettingsBody } = settingsDialog;
    const { SidebarMetrics } = sidebarMetrics;
    const { FooterStatus } = footerStatus;
    const panelMount = createReactiveSlotMount(true);
    const sidebarMount = createReactiveSlotMount(true);
    const footerMount = createReactiveSlotMount(false);
    let unregisterPanel;
    try {
      unregisterPanel = context.ui.slot({
        append: "session.panel",
        // v0.7.12: the panel body (header clock, detail tables) froze at its
        // first paint until the render was wrapped reactively. The
        // non-matching render path also releases the panel's "f" fullscreen
        // keymap layer (see createStatsPanel).
        // v0.7.22: the wrap is now a plugin-graph reactive mount
        // (reactive-mount.ts) — host-side insertion of function children
        // produced a mount-time snapshot on the real machine.
        render: (panel) => {
          if (panel?.name !== PANEL_NAME) {
            statsPanel.disposeFullscreenLayer();
            return /* @__PURE__ */ jsx5("box", { width: "100%", flexDirection: "column" });
          }
          return panelMount.swap(() => /* @__PURE__ */ jsx5(StatsPanel, { panel }));
        }
      });
    } catch (error) {
      console.error("[usage-meter] session.panel slot failed:", error);
    }
    let unregisterSidebarSlot;
    try {
      unregisterSidebarSlot = context.ui.slot({
        append: "sidebar.content",
        // v0.7.10/v0.7.16: function-child wrapping never made this block live
        // on the real machine — the host inserts those children with its own
        // @opentui/solid/solid-js graph, so the tracked effects never saw
        // our memos and the block stayed a mount-time snapshot (pitfall #13,
        // verdict 2026-10-12). v0.7.22+: the render returns a core box the
        // plugin itself inserted the component into (reactive-mount.ts), the
        // proven OMO-Slim reactiveElement pattern.
        render: (sidebarProps) => {
          if (!sidebarProps?.sessionID) return null;
          return sidebarMount.swap(() => /* @__PURE__ */ jsx5(SidebarMetrics, { sessionID: sidebarProps.sessionID }));
        }
      });
    } catch (error) {
      console.error("[usage-meter] sidebar.content slot failed:", error);
    }
    let layerDispose;
    let unregisterAppSlot;
    try {
      unregisterAppSlot = context.ui.slot({
        append: "app",
        render: () => {
          if (layerDispose === void 0) {
            try {
              layerDispose = context.keymap?.layer?.(() => ({
                mode: "global",
                commands: [
                  {
                    id: "usage-meter.usage",
                    title: "\u7528\u91CF\u7EDF\u8BA1(\u9762\u677F\u5F00\u5173)",
                    group: "usage-meter",
                    palette: true,
                    slash: { name: "usage-full" },
                    run: () => {
                      void runTokensCommand();
                    }
                  },
                  {
                    // v0.6.7: /usage-settings — extensible settings dialog
                    // (footer hit dimension today; more items later).
                    id: "usage-meter.settings",
                    title: "\u7528\u91CF\u8BBE\u7F6E(footer \u6307\u6807\u7EF4\u5EA6\u7B49)",
                    group: "usage-meter",
                    palette: true,
                    slash: { name: "usage-settings" },
                    run: () => {
                      try {
                        context.ui.dialog.set({ size: "large", centered: true });
                      } catch {
                      }
                      try {
                        context.ui.dialog.show(
                          () => /* @__PURE__ */ jsx5(SettingsBody, {}),
                          () => settingsDialog.disposeKeymapLayer()
                        );
                      } catch (error) {
                        console.error("[usage-meter] settings dialog failed:", error);
                      }
                    }
                  },
                  {
                    // Palette-only backup toggle: works even if the dialog's
                    // in-dialog keybind cannot register on some hosts.
                    id: "usage-meter.hit-scope",
                    title: "\u5207\u6362 hit \u7EF4\u5EA6(\u4ECA\u65E5\u6C47\u603B \u21C4 \u5F53\u524D\u4F1A\u8BDD)",
                    group: "usage-meter",
                    palette: true,
                    run: () => {
                      const nextHitScope = settings.hitScopeEnabled() === "session" ? "today" : "session";
                      settings.toggleHitScope();
                      try {
                        ;
                        context.ui?.toast?.show?.({
                          title: "usage-meter",
                          message: nextHitScope === "session" ? "hit \u7EF4\u5EA6:\u5F53\u524D\u4F1A\u8BDD(hit\xB7s,\u4E25\u683C\u53E3\u5F84)" : "hit \u7EF4\u5EA6:\u4ECA\u65E5\u6C47\u603B(hit,\u5168 session)"
                        });
                      } catch {
                      }
                    }
                  }
                ]
              }));
            } catch (error) {
              layerDispose = null;
              console.error("[usage-meter] keymap layer failed:", error);
            }
          }
          return null;
        }
      });
    } catch (error) {
      console.error("[usage-meter] app slot failed:", error);
    }
    listen("session.execution.started", sessionMetrics.onExecutionStarted);
    listen("session.step.started", sessionMetrics.onStepStarted);
    listen("session.execution.succeeded", sessionMetrics.finishTurn);
    listen("session.execution.failed", sessionMetrics.finishTurn);
    listen("session.execution.interrupted", sessionMetrics.finishTurn);
    listen("session.text.delta", sessionMetrics.onSessionDelta);
    listen("session.reasoning.delta", sessionMetrics.onSessionDelta);
    listen("session.tool.input.delta", sessionMetrics.onSessionDelta);
    listen("session.step.ended", sessionMetrics.onStepEnded);
    listen("session.step.failed", sessionMetrics.onStepEnded);
    listen("message.part.delta", sessionMetrics.onLegacyDelta);
    listen("message.updated", sessionMetrics.onMessageUpdated);
    statsSource.fetchTotals();
    const statsInterval = setInterval(() => statsSource.fetchTotals(), 6e4);
    let unregisterFooterSlot;
    try {
      unregisterFooterSlot = context.ui.slot({
        append: "prompt.footer.status",
        render: (slotProps) => {
          return footerMount.swap(() => /* @__PURE__ */ jsx5(FooterStatus, { slotProps }));
        }
      });
    } catch (error) {
      console.error("[usage-meter] prompt.footer.status slot failed:", error);
    }
    return () => {
      clearInterval(timer);
      clearInterval(statsInterval);
      statsSource.release();
      footerMount.release();
      sidebarMount.release();
      panelMount.release();
      if (typeof unregisterFooterSlot === "function") {
        try {
          unregisterFooterSlot();
        } catch {
        }
      }
      if (typeof unregisterSidebarSlot === "function") {
        try {
          unregisterSidebarSlot();
        } catch {
        }
      }
      if (typeof unregisterAppSlot === "function") {
        try {
          unregisterAppSlot();
        } catch {
        }
      }
      if (typeof unregisterPanel === "function") {
        try {
          unregisterPanel();
        } catch {
        }
      }
      if (typeof layerDispose === "function") {
        try {
          layerDispose();
        } catch {
        }
      } else if (layerDispose && typeof layerDispose.dispose === "function") {
        try {
          layerDispose.dispose();
        } catch {
        }
      }
      statsPanel.disposeFullscreenLayer();
      settingsDialog.disposeKeymapLayer();
      subs.forEach((stop) => {
        try {
          stop();
        } catch {
        }
      });
      sessionMetrics.release();
      calibration.release();
      settings.release();
    };
  }
});
export {
  tui_default as default
};
