import { ConfigurationError, TimeoutError } from './errors.ts'

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, '')
}

export function resolveFetch(override?: typeof fetch): typeof fetch {
  const resolved = override ?? (globalThis as unknown as { fetch?: typeof fetch }).fetch
  if (!resolved) {
    throw new ConfigurationError(
      'No fetch implementation available. Provide a fetchImplementation option or use Node.js >= 18.',
    )
  }
  return resolved
}

export async function extractResponseErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as Record<string, unknown>
    if (typeof body?.message === 'string') {
      return `: ${body.message}`
    }
  } catch {}

  return ''
}

export async function executeWithTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T> | T,
  timeout?: number,
  outerSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  const cleanups: Array<() => void> = []

  if (outerSignal?.aborted) {
    controller.abort()
  } else if (outerSignal) {
    const onAbort = () => controller.abort()
    outerSignal.addEventListener('abort', onAbort, { once: true })
    cleanups.push(() => outerSignal.removeEventListener('abort', onAbort))
  }

  if (timeout === undefined) {
    try {
      return await fn(controller.signal)
    } finally {
      for (const cleanup of cleanups) cleanup()
    }
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    const fnPromise = Promise.resolve(fn(controller.signal))
    // Prevent unhandled rejection if timeout wins the race
    fnPromise.catch(() => {})

    return await Promise.race<T>([
      fnPromise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort()
          reject(new TimeoutError(`Operation timed out after ${timeout}ms`))
        }, timeout)
      }),
    ])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    for (const cleanup of cleanups) cleanup()
  }
}

export async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T | never,
): Promise<T> {
  // Prevent unhandled rejection if timeout wins and promise later rejects
  promise.catch(() => {})
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((resolve, reject) => {
        timeoutId = setTimeout(() => {
          try {
            resolve(onTimeout())
          } catch (err) {
            reject(err)
          }
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

export function createTimeoutSignal(
  timeoutMs: number,
  outerSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  if (typeof timeoutId === 'object' && 'unref' in timeoutId) {
    ;(timeoutId as NodeJS.Timeout).unref()
  }
  const signal = outerSignal ? AbortSignal.any([controller.signal, outerSignal]) : controller.signal
  return { signal, cleanup: () => clearTimeout(timeoutId) }
}

export function validateRequiredStrings<T extends Record<string, unknown>>(
  options: T,
  keys: Array<keyof T & string>,
): void {
  for (const key of keys) {
    if (!options[key] || typeof options[key] !== 'string') {
      throw new ConfigurationError(`${key} must be a non-empty string`)
    }
  }
}
