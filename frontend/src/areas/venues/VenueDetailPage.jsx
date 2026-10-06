import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { useAuth } from '../../app/auth'
import { formatDateTimePeriod, formatTime } from '../../app/format'
import { blockVenue, getVenue, listVenueBlocks } from './api'

// Operating hours are two values, each through formatTime: format.js has no
// function for a time range without a date (docs/design/ui-guidelines.md §9).
const time = (value) => (value ? formatTime(value) : 'None')
const list = (values) => (values && values.length > 0 ? values.join(', ') : 'None')

// SCRUM-40: the block form's fields in form order. `name` is the API field;
// the test id uses it in kebab-case (ui-guidelines.md §5, §7).
const BLOCK_FIELDS = [
  { name: 'start_date', label: 'Start date', type: 'date' },
  { name: 'start_time', label: 'Start time', type: 'time' },
  { name: 'end_date', label: 'End date', type: 'date' },
  { name: 'end_time', label: 'End time', type: 'time' },
  { name: 'reason', label: 'Reason', type: 'textarea' },
]

const EMPTY_BLOCK = Object.fromEntries(BLOCK_FIELDS.map((field) => [field.name, '']))

const kebab = (name) => name.replaceAll('_', '-')

// The API's order: earliest start first, then id. start is 'YYYY-MM-DDTHH:MM',
// so comparing the strings compares the moments.
const byStartThenId = (a, b) => a.start.localeCompare(b.start) || a.id - b.id

// SCRUM-31: every field recorded for one venue, or the API refusal.
// SCRUM-40: the venue's blocks, and for Venue Staff an inline form to block
// it for a period with a reason (ui-guidelines.md §7).
export default function VenueDetailPage() {
  const { id } = useParams()
  const routerLocation = useLocation()
  const { can } = useAuth()
  const [row, setRow] = useState(null)
  const [blocks, setBlocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)
  // The success banner shows on the page the user lands on after saving
  // (docs/design/ui-guidelines.md §4), and after blocking the venue here.
  const [success, setSuccess] = useState(routerLocation.state?.banner ?? null)
  const [blockOpen, setBlockOpen] = useState(false)
  const [blockValues, setBlockValues] = useState(EMPTY_BLOCK)
  const [blockErrors, setBlockErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  const canBlock = can('venues.edit')

  // Keyed to id: a reply for the venue the user has left can
  // arrive after the current one, so a stale reply is ignored
  // (docs/design/frontend.md section 7).
  useEffect(() => {
    let active = true
    Promise.all([getVenue(id), listVenueBlocks(id)])
      .then(([venue, venueBlocks]) => {
        if (active) {
          setRow(venue)
          setBlocks(venueBlocks)
        }
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

  const openBlock = () => {
    setBlockOpen(true)
    setBlockValues(EMPTY_BLOCK)
    setBlockErrors({})
    setBanner(null)
    setSuccess(null)
  }

  const closeBlock = () => {
    setBlockOpen(false)
    setBlockErrors({})
  }

  // The page checks only that each field is filled; every other rule is the
  // API's and shows in the banner (ui-guidelines.md §5).
  const handleBlock = async (event) => {
    event.preventDefault()
    setBanner(null)
    setSuccess(null)
    const errors = {}
    for (const field of BLOCK_FIELDS) {
      if (!blockValues[field.name].trim()) errors[field.name] = `${field.label} is required`
    }
    setBlockErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    try {
      const created = await blockVenue(id, blockValues)
      // Inserted in the API's order, so the new row does not move on reload.
      setBlocks((current) => [...current, created].sort(byStartThenId))
      setBlockOpen(false)
      setSuccess('Venue blocked')
    } catch (error) {
      setBanner(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link to="/venues" className="back-link" data-testid="venue-detail-back-link">
          Back to Venues
        </Link>
        <div className="page-header">
          <h1 className="page-title" data-testid="venue-detail-title">
            Venue
          </h1>
        </div>
      </div>

      {banner ? (
        <p role="alert" className="banner-error" data-testid="venue-detail-banner">
          {banner}
        </p>
      ) : (
        success && (
          <p role="status" className="banner-success" data-testid="venue-detail-banner">
            {success}
          </p>
        )
      )}

      {loading || !row ? null : (
        <>
          <div className="card">
            <dl className="detail-list" data-testid="venue-detail-fields">
              <div>
                <dt>Name</dt>
                <dd data-testid="venue-detail-name">{row.name}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd data-testid="venue-detail-location">{row.location}</dd>
              </div>
              <div>
                <dt>Maximum capacity</dt>
                <dd data-testid="venue-detail-max-capacity">{row.max_capacity}</dd>
              </div>
              <div>
                <dt>Opening time</dt>
                <dd data-testid="venue-detail-opening-time">{time(row.opening_time)}</dd>
              </div>
              <div>
                <dt>Closing time</dt>
                <dd data-testid="venue-detail-closing-time">{time(row.closing_time)}</dd>
              </div>
              <div>
                <dt>Facilities</dt>
                <dd data-testid="venue-detail-facilities">{list(row.facilities)}</dd>
              </div>
              <div>
                <dt>Accessibility features</dt>
                <dd data-testid="venue-detail-accessibility-features">{list(row.accessibility_features)}</dd>
              </div>
            </dl>
          </div>

          {canBlock && (
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={openBlock}
                className="btn btn-primary"
                data-testid="venue-detail-block-button"
              >
                Block venue
              </button>
            </div>
          )}

          {blockOpen && (
            <form onSubmit={handleBlock} noValidate className="card form-card space-y-4">
              <h2 className="section-title">Block venue</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {BLOCK_FIELDS.map((field) => {
                  const inputId = `venue-detail-block-${kebab(field.name)}`
                  const inputProps = {
                    id: inputId,
                    value: blockValues[field.name],
                    onChange: (changed) =>
                      setBlockValues((current) => ({ ...current, [field.name]: changed.target.value })),
                    'aria-required': 'true',
                    className: 'input',
                    'data-testid': `${inputId}-input`,
                  }
                  return (
                    <div key={field.name} className={field.type === 'textarea' ? 'md:col-span-2' : undefined}>
                      <label htmlFor={inputId} className="label">
                        {field.label} *
                      </label>
                      {field.type === 'textarea' ? (
                        <textarea {...inputProps} />
                      ) : (
                        <input type={field.type} {...inputProps} />
                      )}
                      {blockErrors[field.name] && (
                        <p className="field-error" data-testid={`${inputId}-error`}>
                          {blockErrors[field.name]}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={closeBlock}
                  className="btn btn-secondary"
                  data-testid="venue-detail-block-cancel-button"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary"
                  data-testid="venue-detail-block-confirm-button"
                >
                  Block
                </button>
              </div>
            </form>
          )}

          <section className="space-y-4">
            <h2 className="section-title">Blocks</h2>
            {blocks.length === 0 ? (
              <div className="card">
                <p className="empty-state" data-testid="venue-detail-blocks-empty">
                  This venue has no blocks.
                </p>
              </div>
            ) : (
              <div className="card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blocks.map((block) => (
                        <tr key={block.id} data-testid={`venue-detail-block-row-${block.id}`}>
                          <td data-testid={`venue-detail-block-period-${block.id}`}>
                            {formatDateTimePeriod(block.start, block.end)}
                          </td>
                          <td className="whitespace-pre-wrap" data-testid={`venue-detail-block-reason-${block.id}`}>
                            {block.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
