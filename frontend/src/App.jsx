import { useState } from 'react'

function App() {
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handlePing() {
    setLoading(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/ping')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setMessage(data.message)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold text-gray-900">
        ConnectSphere Event Planning
      </h1>
      <p className="text-gray-500">Phase 1 scaffold — backend connectivity check</p>

      <button
        onClick={handlePing}
        disabled={loading}
        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
      >
        {loading ? 'Pinging...' : 'Ping Backend'}
      </button>

      {message && (
        <p className="text-green-600 font-medium" data-testid="ping-result">
          Backend says: {message}
        </p>
      )}
      {error && (
        <p className="text-red-600 font-medium" data-testid="ping-error">
          Error: {error}
        </p>
      )}
    </div>
  )
}

export default App
