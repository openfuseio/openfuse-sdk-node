import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiHealthTracker } from '../../../src/core/api-health.ts'

describe('ApiHealthTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts in healthy state', () => {
    const tracker = new ApiHealthTracker()
    expect(tracker.shouldAttemptRequest()).toBe(true)
    expect(tracker.isDegraded).toBe(false)
  })

  it('stays healthy after fewer failures than threshold', () => {
    const tracker = new ApiHealthTracker({ failureThreshold: 3 })
    tracker.recordFailure()
    tracker.recordFailure()
    expect(tracker.shouldAttemptRequest()).toBe(true)
    expect(tracker.isDegraded).toBe(false)
  })

  it('enters degraded mode after reaching failure threshold', () => {
    const tracker = new ApiHealthTracker({ failureThreshold: 3 })
    tracker.recordFailure()
    tracker.recordFailure()
    tracker.recordFailure()
    expect(tracker.shouldAttemptRequest()).toBe(false)
    expect(tracker.isDegraded).toBe(true)
  })

  it('allows probe request after degraded window expires', () => {
    const tracker = new ApiHealthTracker({ failureThreshold: 3, degradedWindowMs: 30_000 })
    tracker.recordFailure()
    tracker.recordFailure()
    tracker.recordFailure()
    expect(tracker.shouldAttemptRequest()).toBe(false)

    vi.advanceTimersByTime(30_000)
    expect(tracker.shouldAttemptRequest()).toBe(true)
  })

  it('extends degraded window if probe fails', () => {
    const tracker = new ApiHealthTracker({ failureThreshold: 3, degradedWindowMs: 30_000 })
    tracker.recordFailure()
    tracker.recordFailure()
    tracker.recordFailure()

    vi.advanceTimersByTime(30_000)
    expect(tracker.shouldAttemptRequest()).toBe(true)

    // Probe fails
    tracker.recordFailure()
    expect(tracker.shouldAttemptRequest()).toBe(false)
    expect(tracker.isDegraded).toBe(true)

    // Must wait another full window
    vi.advanceTimersByTime(29_999)
    expect(tracker.shouldAttemptRequest()).toBe(false)

    vi.advanceTimersByTime(1)
    expect(tracker.shouldAttemptRequest()).toBe(true)
  })

  it('recordSuccess resets to healthy state', () => {
    const tracker = new ApiHealthTracker({ failureThreshold: 3 })
    tracker.recordFailure()
    tracker.recordFailure()
    tracker.recordFailure()
    expect(tracker.isDegraded).toBe(true)

    tracker.recordSuccess()
    expect(tracker.shouldAttemptRequest()).toBe(true)
    expect(tracker.isDegraded).toBe(false)
  })

  it('reset() clears all state', () => {
    const tracker = new ApiHealthTracker({ failureThreshold: 3 })
    tracker.recordFailure()
    tracker.recordFailure()
    tracker.recordFailure()
    expect(tracker.isDegraded).toBe(true)

    tracker.reset()
    expect(tracker.shouldAttemptRequest()).toBe(true)
    expect(tracker.isDegraded).toBe(false)
  })

  it('success after partial failures resets counter', () => {
    const tracker = new ApiHealthTracker({ failureThreshold: 3 })
    tracker.recordFailure()
    tracker.recordFailure()
    tracker.recordSuccess()
    tracker.recordFailure()
    tracker.recordFailure()
    // Only 2 consecutive failures, not 3
    expect(tracker.shouldAttemptRequest()).toBe(true)
    expect(tracker.isDegraded).toBe(false)
  })

  it('uses default options', () => {
    const tracker = new ApiHealthTracker()
    // Default threshold is 3
    tracker.recordFailure()
    tracker.recordFailure()
    expect(tracker.shouldAttemptRequest()).toBe(true)
    tracker.recordFailure()
    expect(tracker.isDegraded).toBe(true)

    // Default window is 30s
    vi.advanceTimersByTime(29_999)
    expect(tracker.shouldAttemptRequest()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(tracker.shouldAttemptRequest()).toBe(true)
  })
})
