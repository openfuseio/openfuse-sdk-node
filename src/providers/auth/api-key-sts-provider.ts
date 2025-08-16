import { AuthError } from '../../core/errors.ts'
import type { TRegion, TTokenProvider } from '../../core/types.ts'

type TApiKeySTSProviderOptions = { apiKey: string; region: TRegion }

export class ApiKeySTSProvider implements TTokenProvider {
  private cachedTokenRecord?: { token: string; expirationEpochMilliseconds: number }
  private apiKey: string
  private region: TRegion

  constructor(options: TApiKeySTSProviderOptions) {
    this.apiKey = options.apiKey
    this.region = options.region
  }

  async getToken(signal?: AbortSignal): Promise<string> {
    const nowEpochMilliseconds: number = Date.now()
    if (
      this.cachedTokenRecord &&
      nowEpochMilliseconds < this.cachedTokenRecord.expirationEpochMilliseconds - 30_000
    ) {
      return this.cachedTokenRecord.token
    }

    const stsUrl: string = `https://sts.openfuse.io/v1/token` // TODO: Confirm sts vs. auth subdomain
    const httpResponse: Response = await fetch(stsUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
      body: JSON.stringify({ grant_type: 'api_key' }),
      signal,
    } as RequestInit)

    if (!httpResponse.ok) throw new AuthError(`STS failed with ${httpResponse.status}`)

    const jsonBody = (await httpResponse.json()) as { access_token: string; expires_in?: number } // TODO: Add validation
    const expirationEpochMilliseconds: number =
      nowEpochMilliseconds + (jsonBody.expires_in ?? 300) * 1000
    this.cachedTokenRecord = { token: jsonBody.access_token, expirationEpochMilliseconds }
    return jsonBody.access_token
  }
}
