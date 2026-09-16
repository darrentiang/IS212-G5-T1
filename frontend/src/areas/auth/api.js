import { request } from '../../app/http'

// POST /api/login
// body:  { username, password }
// 200:   { username, roles, features }
// 401:   { message }
export const login = (username, password) => request('POST', '/api/login', { username, password })

// POST /api/logout
// body:  none
// 204:   no content
export const logout = () => request('POST', '/api/logout')

// GET /api/me
// 200:   { username, roles, features }
// 401:   { message }
export const me = () => request('GET', '/api/me')
