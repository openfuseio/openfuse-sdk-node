import { afterEach, describe, expect, it, vi } from 'vitest'
import { sleep } from '../../../src/core/retry.ts'
import { AbortOperationError } from '../../../src/core/errors.ts'

describe('sleep', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves after the given delay', async () => {
    vi.useFakeTimers()
    const p = sleep(100)
    vi.advanceTimersByTime(100)
    await expect(p).resolves.toBeUndefined()
  })

  it('rejects immediately if signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(sleep(100, controller.signal)).rejects.toBeInstanceOf(AbortOperationError)
  })

  it('rejects when signal is aborted during sleep', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const p = sleep(1000, controller.signal)

    vi.advanceTimersByTime(50)
    controller.abort()

    await expect(p).rejects.toBeInstanceOf(AbortOperationError)
  })

  it('removes abort listener when timeout fires normally (no leak)', async () => {
    const controller = new AbortController()
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')

    vi.useFakeTimers()
    const p = sleep(100, controller.signal)
    vi.advanceTimersByTime(100)
    await p

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
