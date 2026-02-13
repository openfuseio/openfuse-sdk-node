import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MetricsFeature } from '../../../../src/domains/metrics/metrics.feature.ts'
import type { TMetric } from '../../../../src/domains/metrics/types.ts'

function createMockDeps(configOverrides?: Record<string, unknown>) {
  const api = { listMetrics: vi.fn(), ingest: vi.fn() }
  const breakersFeature = { resolveBreakerId: vi.fn() }
  return {
    api: api as never,
    breakersFeature: breakersFeature as never,
    instanceId: 'test-instance',
    getSystemId: () => 'system-1',
    config: { enabled: true, ...configOverrides },
    // expose raw mocks for assertions
    _api: api,
    _breakersFeature: breakersFeature,
  }
}

describe('MetricsFeature - flush worker lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not start the flush timer on construction', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval')
    const deps = createMockDeps()

    new MetricsFeature(deps)

    expect(setIntervalSpy).not.toHaveBeenCalled()
  })

  it('starts the flush timer on first recordExecution()', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval')
    const deps = createMockDeps()
    const feature = new MetricsFeature(deps)

    feature.recordExecution('breaker-1', 'success', 100)

    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
  })

  it('calls .unref() on the timer', () => {
    const unrefSpy = vi.fn()
    vi.spyOn(global, 'setInterval').mockReturnValue({
      unref: unrefSpy,
      ref: vi.fn(),
      [Symbol.dispose]: vi.fn(),
    } as unknown as ReturnType<typeof setInterval>)

    const deps = createMockDeps()
    const feature = new MetricsFeature(deps)

    feature.recordExecution('breaker-1', 'success', 100)

    expect(unrefSpy).toHaveBeenCalledTimes(1)
  })

  it('stop() resets workerStarted; timer restarts on next recordExecution()', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval')
    const deps = createMockDeps()
    const feature = new MetricsFeature(deps)

    feature.recordExecution('breaker-1', 'success', 100)
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)

    feature.stop()

    feature.recordExecution('breaker-1', 'success', 50)
    expect(setIntervalSpy).toHaveBeenCalledTimes(2)
  })

  it('does not start timer when config.enabled is false', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval')
    const deps = createMockDeps({ enabled: false })
    const feature = new MetricsFeature(deps)

    feature.recordExecution('breaker-1', 'success', 100)

    expect(setIntervalSpy).not.toHaveBeenCalled()
  })
})

describe('MetricsFeature - metric definitions survive indefinitely (Fix 1)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('metric IDs remain resolvable after 10+ minutes (no TTL expiry)', async () => {
    const deps = createMockDeps({
      windowSizeMs: 1_000,
      flushIntervalMs: 60_000, // large interval to avoid auto-flush interference
    })
    const feature = new MetricsFeature(deps)

    const mockMetrics: TMetric[] = [
      { id: 'metric-success', slug: 'success', name: 'Success', unit: 'count' },
      { id: 'metric-failure', slug: 'failure', name: 'Failure', unit: 'count' },
      { id: 'metric-timeout', slug: 'timeout', name: 'Timeout', unit: 'count' },
      { id: 'metric-total', slug: 'total', name: 'Total', unit: 'count' },
    ]

    deps._api.listMetrics.mockResolvedValue(mockMetrics)
    deps._api.ingest.mockResolvedValue({ accepted: 1, duplicates: 0 })
    deps._breakersFeature.resolveBreakerId.mockResolvedValue('breaker-id-1')

    // Record in window 0
    feature.recordExecution('breaker-1', 'success', 50)

    // Advance past the window boundary so it's flushable
    vi.advanceTimersByTime(1_500)

    // First flush loads metric definitions and sends data
    await feature.flush()
    expect(deps._api.listMetrics).toHaveBeenCalledTimes(1)
    expect(deps._api.ingest).toHaveBeenCalledTimes(1)

    // Stop the worker so the big time advance doesn't trigger auto-flushes
    feature.stop()

    // Advance 15 minutes — well past the old 10-min TTL
    vi.advanceTimersByTime(15 * 60 * 1_000)

    // Record another execution in a new window (this restarts the worker)
    feature.recordExecution('breaker-1', 'success', 60)

    // Advance past the window boundary
    vi.advanceTimersByTime(1_500)

    // Second flush should still succeed because metric IDs never expired
    await feature.flush()
    expect(deps._api.listMetrics).toHaveBeenCalledTimes(1) // NOT re-fetched
    expect(deps._api.ingest).toHaveBeenCalledTimes(2) // Second ingest went through

    // Verify the second ingest included metric IDs (not discarded)
    const secondIngest = deps._api.ingest.mock.calls[1][0]
    expect(secondIngest.breakers.length).toBeGreaterThan(0)
    expect(secondIngest.breakers[0].metrics.length).toBeGreaterThan(0)

    feature.stop()
  })
})

describe('MetricsFeature - empty metric definitions are cached (Fix 4)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not re-fetch when server returns empty metric definitions', async () => {
    const deps = createMockDeps({
      windowSizeMs: 1_000,
      flushIntervalMs: 2_000,
    })
    const feature = new MetricsFeature(deps)

    // Server returns empty array (no metric definitions configured)
    deps._api.listMetrics.mockResolvedValue([])
    deps._breakersFeature.resolveBreakerId.mockResolvedValue('breaker-id-1')

    // Record and advance past window
    feature.recordExecution('breaker-1', 'success', 50)
    vi.advanceTimersByTime(1_500)

    // First flush — loads (empty) definitions
    await feature.flush()
    expect(deps._api.listMetrics).toHaveBeenCalledTimes(1)

    // Record more data
    feature.recordExecution('breaker-1', 'success', 60)
    vi.advanceTimersByTime(1_500)

    // Second flush — should NOT call listMetrics again
    await feature.flush()
    expect(deps._api.listMetrics).toHaveBeenCalledTimes(1)
  })
})
