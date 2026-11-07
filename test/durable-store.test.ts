// Unit tests for src/durable-store.ts — the durable storage-store bootstrap
// shared by calibration and settings. It centralizes the guarded
// context.storage.store(...) read and the single reason-line logged when the
// host cannot provide a store, so both factories report the same way.
import { test } from "node:test"
import assert from "node:assert/strict"
import { noopRelease, openStore } from "../src/durable-store.ts"

// Capture console.error so a logging test can assert on the message without
// polluting the runner output, always restoring the original afterwards.
const withCapturedConsoleError = (run: (messages: any[][]) => void): void => {
  const messages: any[][] = []
  const originalConsoleError = console.error
  console.error = (...args: any[]) => {
    messages.push(args)
  }
  try {
    run(messages)
  } finally {
    console.error = originalConsoleError
  }
}

test("openStore returns the host state and update when a store is provided", () => {
  const hostState = { enabled: true }
  const hostUpdate = async () => {}
  const storeCalls: { name: string; initial: unknown }[] = []
  const context = {
    storage: {
      store: (name: string, options: { initial: unknown }) => {
        storeCalls.push({ name, initial: options.initial })
        return [hostState, hostUpdate]
      },
    },
  }
  const store = openStore(context, "usage_meter_settings", { enabled: false })
  assert.equal(store.state, hostState)
  assert.equal(store.update, hostUpdate)
  assert.deepEqual(storeCalls, [{ name: "usage_meter_settings", initial: { enabled: false } }])
})

test("openStore falls back to the initial state when the host returns undefined", () => {
  const context = { storage: { store: () => [undefined, undefined] } }
  const store = openStore(context, "usage_meter_calibration", { factor: 1 })
  assert.deepEqual(store.state, { factor: 1 })
  assert.equal(store.update, undefined)
})

test("openStore logs once and stays inert when storage.store is unavailable", () => {
  withCapturedConsoleError((messages) => {
    const store = openStore({}, "usage_meter_settings", { total: 0 })
    assert.deepEqual(store, { state: { total: 0 }, update: undefined })
    assert.equal(messages.length, 1)
    assert.match(String(messages[0][0]), /storage\.store unavailable/)
    assert.match(String(messages[0][0]), /usage_meter_settings/)
  })
})

test("openStore logs the creation failure and falls back to the initial state", () => {
  const failure = new Error("storage subsystem down")
  const context = { storage: { store: () => {
    throw failure
  } } }
  withCapturedConsoleError((messages) => {
    const store = openStore(context, "usage_meter_calibration", { factor: 2 })
    assert.deepEqual(store.state, { factor: 2 })
    assert.equal(store.update, undefined)
    assert.equal(messages.length, 1)
    assert.match(String(messages[0][0]), /usage_meter_calibration store creation failed/)
    assert.equal(messages[0][1], failure)
  })
})

test("noopRelease is a deliberate no-op that never throws", () => {
  assert.equal(noopRelease(), undefined)
})
