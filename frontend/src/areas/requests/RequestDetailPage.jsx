import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { getRequest } from './api'

// SCRUM-27: show one request or the API refusal (banner), never invent data.
export default function RequestDetailPage() {
  const { id } = useParams()
  const [row, setRow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)

  useEffect(() => {
    let active = true
    getRequest(id)
      .then((data) => {
        if (active) setRow(data)
      })
      .catch((error) => {
        if (active) setBanner(error.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [id])

  return (
    <div className="space-y-4">
      <Link to="/requests" className="text-blue-700 hover:underline text-sm" data-testid="request-detail-back-link">
        Back to Requests
      </Link>

      <h1 className="text-xl font-semibold text-gray-900" data-testid="request-detail-title">
        Request
      </h1>

      {banner && (
        <p role="alert" className="border border-red-300 bg-red-50 text-red-800 rounded px-3 py-2 text-sm" data-testid="request-detail-banner">
          {banner}
        </p>
      )}

      {loading || banner || !row ? null : (
        <dl className="space-y-2 text-sm" data-testid="request-detail-fields">
          <div>
            <dt className="font-medium text-gray-700">Name</dt>
            <dd data-testid="request-detail-name">{row.name}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">Status</dt>
            <dd data-testid="request-detail-status">{row.status}</dd>
          </div>
          <div>
            <dt className="font-medium text-gray-700">Created by</dt>
            <dd data-testid="request-detail-created-by">{row.created_by}</dd>
          </div>
          {'coordinator_notes' in row && row.coordinator_notes != null && (
            <div>
              <dt className="font-medium text-gray-700">Coordinator notes</dt>
              <dd data-testid="request-detail-coordinator-notes">{row.coordinator_notes}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}
