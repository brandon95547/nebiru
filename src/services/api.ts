/** Calls to the Nebiru server. In development Vite proxies /api to it. */

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, init)
  } catch {
    throw new ApiError('The Nebiru server could not be reached.', 0)
  }
  if (!response.ok) {
    // The server explains its failures in `detail`; anything else is the proxy or a crash.
    let message = `The Nebiru server answered with an error (HTTP ${response.status}).`
    try {
      const body: unknown = await response.json()
      const detail = (body as { detail?: unknown }).detail
      if (typeof detail === 'string' && detail) message = detail
    } catch {
      // Not JSON: keep the generic message.
    }
    throw new ApiError(message, response.status)
  }
  return (await response.json()) as T
}

function send<T>(method: string, path: string, body: unknown): Promise<T> {
  return request<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => send<T>('POST', path, body),
  put: <T = unknown>(path: string, body: unknown) => send<T>('PUT', path, body),
  delete: <T = unknown>(path: string) => request<T>(path, { method: 'DELETE' }),
  /** Send a file as the request body. */
  upload: <T>(path: string, file: File) =>
    request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    }),
}
