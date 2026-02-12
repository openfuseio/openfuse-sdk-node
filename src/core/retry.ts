import { AbortOperationError } from './errors.ts'

export function calculateBackoff(
  attemptIndex: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attemptIndex))
  const jitter = Math.random() * 0.25 * exponential
  return exponential + jitter
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortOperationError())
      return
    }

    let onAbort: (() => void) | undefined

    const timeoutId = setTimeout(() => {
      if (onAbort) signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    timeoutId.unref()

    if (signal) {
      onAbort = () => {
        clearTimeout(timeoutId)
        reject(new AbortOperationError())
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}
