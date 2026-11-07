// Unit tests for src/session-context.ts — the guarded host reads shared by the
// footer, sidebar and panel surfaces. Both degrade instead of throwing: a stale
// client handle must never poison the reactive render chain.
import { test } from "node:test"
import assert from "node:assert/strict"
import { currentSessionID, isSessionRunning } from "../src/session-context.ts"

test("currentSessionID prefers the slot-provided sessionID", () => {
  const context = { ui: { router: { current: () => ({ type: "session", sessionID: "ses_route" }) } } }
  assert.equal(currentSessionID(context, { sessionID: "ses_slot" }), "ses_slot")
})

test("currentSessionID reads a session route's sessionID, then params fallback", () => {
  const directRoute = { ui: { router: { current: () => ({ type: "session", sessionID: "ses_direct" }) } } }
  assert.equal(currentSessionID(directRoute), "ses_direct")
  const paramsRoute = {
    ui: { router: { current: () => ({ type: "session", params: { sessionID: "ses_params" } }) } },
  }
  assert.equal(currentSessionID(paramsRoute), "ses_params")
})

test("currentSessionID reads params on a non-session route", () => {
  const context = {
    ui: { router: { current: () => ({ type: "home", params: { sessionID: "ses_home" } }) } },
  }
  assert.equal(currentSessionID(context), "ses_home")
})

test("currentSessionID degrades to undefined when the router read throws", () => {
  const context = { ui: { router: { current: () => {
    throw new Error("stale client handle")
  } } } }
  assert.equal(currentSessionID(context), undefined)
})

test("currentSessionID returns undefined when no session id is present", () => {
  assert.equal(currentSessionID({}), undefined)
  assert.equal(
    currentSessionID({ ui: { router: { current: () => ({ type: "home" }) } } }),
    undefined,
  )
})

test("isSessionRunning reports true only for a running status", () => {
  const running = { data: { session: { status: () => "running" } } }
  assert.equal(isSessionRunning(running, "ses_one"), true)
  const idle = { data: { session: { status: () => "idle" } } }
  assert.equal(isSessionRunning(idle, "ses_one"), false)
})

test("isSessionRunning degrades to false when the status read throws or is absent", () => {
  const staleHandle = { data: { session: { status: () => {
    throw new Error("stale client handle")
  } } } }
  assert.equal(isSessionRunning(staleHandle, "ses_one"), false)
  assert.equal(isSessionRunning({}, "ses_one"), false)
})
