// The only file in the front end that calls fetch (docs/design/frontend.md §6).
// It never navigates and never renders: callers decide what a failure looks like.

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function readBody(response) {
  // 204 replies (logout) have no body, and an error page may not be JSON.
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function request(method, path, body) {
  const options = {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) {
    options.body = JSON.stringify(body)
  }

  const response = await fetch(path, options)
  const payload = await readBody(response)

  if (!response.ok) {
    // Every refusal from the API is { "message": "…" }; anything else (a
    // server error page, an endpoint that does not exist yet) still has to
    // reach the user as a sentence.
    throw new ApiError(response.status, payload?.message ?? `Request failed (${response.status})`)
  }

  return payload
}
