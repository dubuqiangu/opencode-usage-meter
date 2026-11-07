// Unit tests for src/layer-lifecycle.ts — the throttled keymap-layer create
// decision (shouldAttemptLayerCreate) and the dual-shape layer release
// (createDisposableLayer), lifted out of stats-panel.tsx / settings-dialog.tsx
// in 0.7.38 so node:test can cover the retry and release rules directly.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  createDisposableLayer,
  shouldAttemptLayerCreate,
} from "../src/layer-lifecycle.ts"

test("shouldAttemptLayerCreate fires only while no layer is held and the throttle elapsed", () => {
  const intervalMs = 1_000
  // No handle yet and never failed: first attempt is allowed.
  assert.equal(shouldAttemptLayerCreate(5_000, undefined, 0, intervalMs), true)
  // A held handle (function or object) blocks every retry until released.
  assert.equal(shouldAttemptLayerCreate(5_000, () => {}, 0, intervalMs), false)
  assert.equal(shouldAttemptLayerCreate(5_000, { dispose: () => {} }, 0, intervalMs), false)
})

test("shouldAttemptLayerCreate throttles retries after a failed create", () => {
  const intervalMs = 1_000
  const failureAt = 4_000
  // Too soon after the failure: hold off.
  assert.equal(shouldAttemptLayerCreate(4_500, undefined, failureAt, intervalMs), false)
  // Exactly at the interval boundary: retry.
  assert.equal(shouldAttemptLayerCreate(5_000, undefined, failureAt, intervalMs), true)
  // Well past the interval: retry.
  assert.equal(shouldAttemptLayerCreate(9_000, undefined, failureAt, intervalMs), true)
})

test("createDisposableLayer invokes a function handle and then clears it", () => {
  const layer = createDisposableLayer()
  let disposals = 0
  layer.set(() => {
    disposals += 1
  })
  assert.equal(typeof layer.current(), "function")
  layer.dispose()
  assert.equal(disposals, 1)
  assert.equal(layer.current(), undefined)
  // Disposing again is a safe no-op.
  assert.doesNotThrow(() => layer.dispose())
  assert.equal(disposals, 1)
})

test("createDisposableLayer invokes an object handle's dispose method", () => {
  const layer = createDisposableLayer()
  let disposals = 0
  layer.set({ dispose: () => {
    disposals += 1
  } })
  layer.dispose()
  assert.equal(disposals, 1)
  assert.equal(layer.current(), undefined)
})

test("createDisposableLayer treats a null handle as already released", () => {
  const layer = createDisposableLayer()
  // A create that threw is recorded as null; release must not blow up.
  layer.set(null)
  assert.doesNotThrow(() => layer.dispose())
  assert.equal(layer.current(), undefined)
})

test("createDisposableLayer swallows throws from an unruly handle", () => {
  const layer = createDisposableLayer()
  layer.set(() => {
    throw new Error("host teardown blew up")
  })
  assert.doesNotThrow(() => layer.dispose())
  assert.equal(layer.current(), undefined)
})
