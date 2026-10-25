// Unit tests for src/live-rate.ts — the shared "hold the last live reading and
// dim it" rule used by both ⚡ surfaces (footer row, right-sidebar block).
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  resolveLiveRateReading,
  type LiveRateMemoryEntry,
} from "../src/live-rate.ts"

test("live value resolves un-dimmed and is recorded in the memory", () => {
  const memory = new Map<string, LiveRateMemoryEntry>()
  const reading = resolveLiveRateReading(memory, "session-a", 1_000, 42)
  assert.deepEqual(reading, { tokensPerSecond: 42, dim: false })
  assert.deepEqual(memory.get("session-a"), { turnStartedAt: 1_000, tokensPerSecond: 42 })
})

test("missing live value with a matching turn stamp returns the held reading dimmed", () => {
  const memory = new Map<string, LiveRateMemoryEntry>([
    ["session-a", { turnStartedAt: 1_000, tokensPerSecond: 42 }],
  ])
  const reading = resolveLiveRateReading(memory, "session-a", 1_000, undefined)
  assert.deepEqual(reading, { tokensPerSecond: 42, dim: true })
})

test("missing live value with a mismatched turn stamp does not revive the previous turn", () => {
  const memory = new Map<string, LiveRateMemoryEntry>([
    ["session-a", { turnStartedAt: 1_000, tokensPerSecond: 42 }],
  ])
  assert.equal(resolveLiveRateReading(memory, "session-a", 2_000, undefined), undefined)
})

test("missing live value with no memory at all returns undefined", () => {
  const memory = new Map<string, LiveRateMemoryEntry>()
  assert.equal(resolveLiveRateReading(memory, "session-a", 1_000, undefined), undefined)
})

test("a later live value within the same turn replaces the held reading", () => {
  const memory = new Map<string, LiveRateMemoryEntry>()
  resolveLiveRateReading(memory, "session-a", 1_000, 40)
  const reading = resolveLiveRateReading(memory, "session-a", 1_000, 55)
  assert.deepEqual(reading, { tokensPerSecond: 55, dim: false })
  assert.deepEqual(memory.get("session-a"), { turnStartedAt: 1_000, tokensPerSecond: 55 })
})
