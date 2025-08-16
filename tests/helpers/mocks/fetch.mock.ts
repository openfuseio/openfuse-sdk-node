type FetchArgs = Parameters<typeof fetch>
type FetchInput = FetchArgs[0]

export type FetchMockItem =
  | Response
  | { body?: unknown; status?: number; headers?: Record<string, string> }
  | ((input: FetchInput, init?: RequestInit) => Response | Promise<Response>)

export function installFetchMock() {
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const queue: FetchMockItem[] = []

  const toUrlString = (input: FetchInput) =>
    typeof input === 'string' ? input : (input as URL).toString()

  const jsonResponse = (body?: unknown, init?: ResponseInit) =>
    new Response(body === undefined ? undefined : JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      ...init,
    })

  const fetchMock: typeof fetch = async (input, init) => {
    const url = toUrlString(input)
    calls.push({ url, init })
    const next = queue.shift()
    if (!next) throw new Error(`No mock queued for fetch: ${url}`)
    if (typeof next === 'function') return await Promise.resolve(next(input, init))
    if (next instanceof Response) return next
    const { body, status = 200, headers } = next
    return jsonResponse(body, { status, headers })
  }

  globalThis.fetch = fetchMock

  return {
    push: (item: FetchMockItem) => queue.push(item),
    pushJson: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) =>
      queue.push({ body, ...init }),
    calls,
    queue,
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
}
