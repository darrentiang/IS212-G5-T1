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

  if (account) {
    return <Navigate to="/requests" replace />
  }

  async function handleSubmit(event) {
    event.preventDefault()

    // The page checks only that the required fields are filled; every other
    // rule is the API's and shows in the banner (ui-guidelines.md §4).
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
      navigate('/requests')
    } catch (error) {
      // A refused login is the API's message, word for word.
      setBanner(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-lg p-6 space-y-5">
        <h1 className="text-xl font-semibold text-gray-900">ConnectSphere Event Planning</h1>

        {banner && (
          <p
            role="alert"
            className="border border-red-300 bg-red-50 text-red-800 rounded px-3 py-2 text-sm"
            data-testid="login-banner"
          >
            {banner}
          </p>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="login-username" className="block text-sm text-gray-700">
              Username *
            </label>
            <input
              id="login-username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              aria-required="true"
              className="w-full border border-gray-300 rounded px-3 py-2"
              data-testid="login-username-input"
            />
            {fieldErrors.username && (
              <p className="text-sm text-red-700" data-testid="login-username-error">
                {fieldErrors.username}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="login-password" className="block text-sm text-gray-700">
              Password *
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-required="true"
              className="w-full border border-gray-300 rounded px-3 py-2"
              data-testid="login-password-input"
            />
            {fieldErrors.password && (
              <p className="text-sm text-red-700" data-testid="login-password-error">
                {fieldErrors.password}
              </p>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              data-testid="login-submit-button"
            >
              Log in
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
