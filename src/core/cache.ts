type TCacheEntry<V> = { value: V; expiresAtEpochMilliseconds: number }

type TTTLCacheOptions = {
  maximumEntries: number
}

export class TTLCache<K, V> {
  private internalStore: Map<K, TCacheEntry<V>> = new Map()
  private maximumEntries: number

  constructor(options: TTTLCacheOptions) {
    this.maximumEntries = options.maximumEntries
  }

  get(cacheKey: K): V | undefined {
    const entry: TCacheEntry<V> | undefined = this.internalStore.get(cacheKey)
    if (!entry) return undefined
    if (Date.now() >= entry.expiresAtEpochMilliseconds) {
      this.internalStore.delete(cacheKey)
      return undefined
    }
    this.internalStore.delete(cacheKey)
    this.internalStore.set(cacheKey, entry)
    return entry.value
  }

  set(cacheKey: K, value: V, timeToLiveMilliseconds: number): void {
    const entry: TCacheEntry<V> = {
      value,
      expiresAtEpochMilliseconds: Date.now() + Math.max(0, timeToLiveMilliseconds),
    }
    this.internalStore.set(cacheKey, entry)
    if (this.internalStore.size > this.maximumEntries) {
      const oldestKey: K | undefined = this.internalStore.keys().next().value as K | undefined
      if (oldestKey !== undefined) this.internalStore.delete(oldestKey)
    }
  }

  hasFresh(cacheKey: K): boolean {
    const entry: TCacheEntry<V> | undefined = this.internalStore.get(cacheKey)
    return !!entry && Date.now() < entry.expiresAtEpochMilliseconds
  }

  delete(cacheKey: K): void {
    this.internalStore.delete(cacheKey)
  }
  clear(): void {
    this.internalStore.clear()
  }
}

export class InflightRequests<K, V> {
  private mapKeyToPromise: Map<K, Promise<V>> = new Map()

  async run(key: K, work: () => Promise<V>): Promise<V> {
    const existingPromise: Promise<V> | undefined = this.mapKeyToPromise.get(key)
    if (existingPromise) return existingPromise
    const promise: Promise<V> = work().finally(() => this.mapKeyToPromise.delete(key))
    this.mapKeyToPromise.set(key, promise)
    return promise
  }
}
