// Retry only read-only session checks; denied sessions never retry.
export async function authRead(path: string, headers?: HeadersInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(path, { headers, cache: 'no-store', signal: AbortSignal.timeout(12000) })
      if (![502, 503, 504].includes(response.status) || attempt === 1) return response
    } catch (error) {
      if (attempt === 1 || !(error instanceof TypeError || (error as Error).name === 'TimeoutError')) throw error
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}
