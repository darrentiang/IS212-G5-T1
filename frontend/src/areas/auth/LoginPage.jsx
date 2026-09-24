import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { useAuth } from '../../app/auth'

export default function LoginPage() {
  const { account, login } = useAuth()
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [banner, setBanner] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // Already logged in: '/' , which App resolves to this account's home page.
  if (account) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(event) {
    event.preventDefault()

    // The page checks only that the required fields are filled; every other
    // rule is the API's and shows in the banner (ui-guidelines.md §5).
    const errors = {}
    if (!username.trim()) errors.username = 'Username is required'
    if (!password) errors.password = 'Password is required'
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      setBanner(null)
      return
    }

    setSubmitting(true)
    setBanner(null)
    try {
      await login(username, password)
      // '/' , not a page: App decides which page this account's features allow.
      navigate('/')
    } catch (error) {
      // A refused login is the API's message, word for word.
      setBanner(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="card w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="page-title login-title">ConnectSphere Event Planning</h1>
          <p className="subtitle">Log in to plan and track your events.</p>
        </div>

        {banner && (
          <p role="alert" className="banner-error" data-testid="login-banner">
            {banner}
          </p>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="login-username" className="label">
              Username *
            </label>
            <input
              id="login-username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              aria-required="true"
              className="input"
              data-testid="login-username-input"
            />
            {fieldErrors.username && (
              <p className="field-error" data-testid="login-username-error">
                {fieldErrors.username}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="login-password" className="label">
              Password *
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-required="true"
              className="input"
              data-testid="login-password-input"
            />
            {fieldErrors.password && (
              <p className="field-error" data-testid="login-password-error">
                {fieldErrors.password}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary w-full"
            data-testid="login-submit-button"
          >
            Log in
          </button>
        </form>
      </div>
    </div>
  )
}
