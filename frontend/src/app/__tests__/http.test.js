import { describe, it, expect, vi, afterEach } from 'vitest'
import { ApiError, request } from '../http'

// http.js is the one file allowed to call fetch, so it is the one test allowed
// to stub it (docs/design/frontend.md §6).
function stubFetch(status, body) {
  return vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('request', () => {
  // @story: setup
  // @ac: frontend-scaffold
  it('returns the parsed body of a 2xx reply and sends the session cookie', async () => {
    const fetchStub = stubFetch(200, { username: 'org1', roles: ['Event Organiser'], features: [] })

    const body = await request('POST', '/api/login', { username: 'org1', password: 'Passw0rd!' })

    expect(body).toEqual({ username: 'org1', roles: ['Event Organiser'], features: [] })
    expect(fetchStub).toHaveBeenCalledWith(
      '/api/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ username: 'org1', password: 'Passw0rd!' }),
      }),
    )
  })

  // @story: setup
  // @ac: frontend-scaffold
  it('throws ApiError carrying the status and the reply message on a refusal', async () => {
    stubFetch(401, { message: 'Invalid username or password' })

    const thrown = await request('POST', '/api/login', {}).catch((error) => error)

    expect(thrown).toBeInstanceOf(ApiError)
    expect(thrown.status).toBe(401)
    expect(thrown.message).toBe('Invalid username or password')
  })

  // @story: setup
  // @ac: frontend-scaffold
  it('still reports a sentence when the failing reply carries no message', async () => {
    stubFetch(404)

    const thrown = await request('GET', '/api/me').catch((error) => error)

    expect(thrown).toBeInstanceOf(ApiError)
    expect(thrown.status).toBe(404)
    expect(thrown.message).toBe('Request failed (404)')
  })

  // @story: setup
  // @ac: frontend-scaffold
  it('treats a non-JSON body as no payload', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('<html>oops</html>'),
    })

    const thrown = await request('GET', '/api/me').catch((error) => error)

    expect(thrown).toBeInstanceOf(ApiError)
    expect(thrown.status).toBe(500)
    expect(thrown.message).toBe('Request failed (500)')
  })
})
