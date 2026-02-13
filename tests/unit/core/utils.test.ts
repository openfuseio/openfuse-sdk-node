import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  executeWithTimeout,
  raceWithTimeout,
  validateRequiredStrings,
} from '../../../src/core/utils.ts'
import { ConfigurationError, TimeoutError } from '../../../src/core/errors.ts'

describe('executeWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('completes normally when no timeout is set', async () => {
    const result = await executeWithTimeout(() => Promise.resolve('ok'))
    expect(result).toBe('ok')
  })

  it('provides an AbortSignal to the function', async () => {
    let receivedSignal: AbortSignal | undefined
    await executeWithTimeout((signal) => {
      receivedSignal = signal
      return 'done'
    })
    expect(receivedSignal).toBeInstanceOf(AbortSignal)
    expect(receivedSignal!.aborted).toBe(false)
  })

  it('throws TimeoutError when the function exceeds the timeout', async () => {
    vi.useFakeTimers()
    const p = executeWithTimeout(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 5000)),
      100,
    )
    vi.advanceTimersByTime(100)
    await expect(p).rejects.toBeInstanceOf(TimeoutError)
  })

  it('aborts the signal when timeout fires', async () => {
    vi.useFakeTimers()
    let receivedSignal: AbortSignal | undefined
    const p = executeWithTimeout((signal) => {
      receivedSignal = signal
      return new Promise<string>((resolve) => setTimeout(() => resolve('late'), 5000))
    }, 50)
    vi.advanceTimersByTime(50)
    await expect(p).rejects.toBeInstanceOf(TimeoutError)
    expect(receivedSignal!.aborted).toBe(true)
  })

  it('forwards an outer AbortSignal to the internal controller', async () => {
    const outer = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const p = executeWithTimeout(
      (signal) => {
        receivedSignal = signal
        return new Promise<string>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      },
      undefined,
      outer.signal,
    )
    outer.abort()
    expect(receivedSignal!.aborted).toBe(true)
    await expect(p).rejects.toThrow('aborted')
  })

  it('handles a pre-aborted outer signal', async () => {
    const outer = new AbortController()
    outer.abort()
    let receivedSignal: AbortSignal | undefined
    await executeWithTimeout(
      (signal) => {
        receivedSignal = signal
        return 'immediate'
      },
      undefined,
      outer.signal,
    )
    expect(receivedSignal!.aborted).toBe(true)
  })

  it('clears the timeout timer on normal completion', async () => {
    vi.useFakeTimers()
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    const p = executeWithTimeout(() => Promise.resolve('fast'), 5000)
    vi.advanceTimersByTime(0)
    await p
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  it('removes abort listener on cleanup', async () => {
    const outer = new AbortController()
    const removeSpy = vi.spyOn(outer.signal, 'removeEventListener')
    await executeWithTimeout(() => 'done', undefined, outer.signal)
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})

describe('raceWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the promise result when it wins the race', async () => {
    const result = await raceWithTimeout(Promise.resolve('fast'), 5000, () => 'slow')
    expect(result).toBe('fast')
  })

  it('returns the onTimeout value when the promise is slow', async () => {
    vi.useFakeTimers()
    const p = raceWithTimeout(
      new Promise<string>((resolve) => setTimeout(() => resolve('late'), 5000)),
      100,
      () => 'timed-out',
    )
    vi.advanceTimersByTime(100)
    const result = await p
    expect(result).toBe('timed-out')
  })

  it('throws when onTimeout throws', async () => {
    vi.useFakeTimers()
    const p = raceWithTimeout(
      new Promise<string>((resolve) => setTimeout(() => resolve('late'), 5000)),
      100,
      () => {
        throw new Error('budget exceeded')
      },
    )
    vi.advanceTimersByTime(100)
    await expect(p).rejects.toThrow('budget exceeded')
  })

  it('clears the timer when promise resolves first', async () => {
    vi.useFakeTimers()
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    const p = raceWithTimeout(Promise.resolve('fast'), 5000, () => 'slow')
    vi.advanceTimersByTime(0)
    await p
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})

describe('validateRequiredStrings', () => {
  it('passes when all keys are non-empty strings', () => {
    expect(() => validateRequiredStrings({ a: 'hello', b: 'world' }, ['a', 'b'])).not.toThrow()
  })

  it('throws ConfigurationError for an empty string', () => {
    expect(() => validateRequiredStrings({ a: '' }, ['a'])).toThrow(ConfigurationError)
    expect(() => validateRequiredStrings({ a: '' }, ['a'])).toThrow('a must be a non-empty string')
  })

  it('throws ConfigurationError for a non-string value', () => {
    expect(() => validateRequiredStrings({ a: 123 }, ['a'])).toThrow(ConfigurationError)
  })

  it('throws ConfigurationError for undefined', () => {
    expect(() => validateRequiredStrings({ a: undefined }, ['a'])).toThrow(ConfigurationError)
  })

  it('throws ConfigurationError for null', () => {
    expect(() => validateRequiredStrings({ a: null }, ['a'])).toThrow(ConfigurationError)
  })

  it('validates only the specified keys', () => {
    expect(() => validateRequiredStrings({ a: 'valid', b: 123 }, ['a'])).not.toThrow()
  })
})
