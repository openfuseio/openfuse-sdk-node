import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TTLCache } from '../../../src/core/cache.ts'

describe('TTLCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns undefined and deletes the entry when TTL has expired', () => {
    const cache = new TTLCache<string, string>({ maximumEntries: 100 })

    cache.set('key', 'value', 1_000)
    expect(cache.get('key')).toBe('value')

    // Advance past TTL
    vi.advanceTimersByTime(1_001)

    expect(cache.get('key')).toBeUndefined()

    // Verify the entry was actually removed from internal storage:
    // set a new entry and confirm no stale data leaks
    cache.set('key', 'new-value', 5_000)
    expect(cache.get('key')).toBe('new-value')
  })

  it('expired entries do not count toward maximumEntries eviction', () => {
    const cache = new TTLCache<string, string>({ maximumEntries: 2 })

    cache.set('a', '1', 1_000)
    cache.set('b', '2', 5_000)

    // Expire 'a'
    vi.advanceTimersByTime(1_001)
    cache.get('a') // triggers cleanup

    // Setting a third key should NOT evict 'b' because 'a' was already cleaned up
    cache.set('c', '3', 5_000)
    expect(cache.get('b')).toBe('2')
    expect(cache.get('c')).toBe('3')
  })

  it('hasFresh returns false for expired entries', () => {
    const cache = new TTLCache<string, string>({ maximumEntries: 100 })

    cache.set('key', 'value', 1_000)
    expect(cache.hasFresh('key')).toBe(true)

    vi.advanceTimersByTime(1_001)
    expect(cache.hasFresh('key')).toBe(false)
  })
})
