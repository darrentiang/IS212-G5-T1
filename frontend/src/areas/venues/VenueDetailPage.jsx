import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { useAuth } from '../../app/auth'
import { formatDateTimePeriod, formatTime } from '../../app/format'
import { blockVenue, endVenueBlock, getVenue, listVenueBlocks, removeVenueBlock } from './api'

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

// SCRUM-79: the end-early form's fields; test ids venue-detail-end-block-<field>-input.
const END_FIELDS = [
  { name: 'end_date', label: 'New end date', type: 'date' },
  { name: 'end_time', label: 'New end time', type: 'time' },
]

const EMPTY_END = Object.fromEntries(END_FIELDS.map((field) => [field.name, '']))

// The block's phase as the API sends it (api.js). Not a status: it only
// decides which action a row offers.
const UPCOMING = 'upcoming'
const IN_PROGRESS = 'in_progress'

const kebab = (name) => name.replaceAll('_', '-')

// The API's order: earliest start first, then id. start is 'YYYY-MM-DDTHH:MM',
// so comparing the strings compares the moments.
const byStartThenId = (a, b) => a.start.localeCompare(b.start) || a.id - b.id

// SCRUM-31: every field recorded for one venue, or the API refusal.
// SCRUM-40: the venue's blocks, and for Venue Staff an inline form to block
// it for a period with a reason (ui-guidelines.md §7).
// SCRUM-79: for Venue Staff, Remove on a block that has not started and End
// early, an inline form for a new end, on a block in progress.
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
  // The block whose end-early form is open. Only one inline form is open at a
  // time (ui-guidelines.md §7), so opening either form closes the other.
  const [endingId, setEndingId] = useState(null)
  const [endValues, setEndValues] = useState(EMPTY_END)
  const [endErrors, setEndErrors] = useState({})
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
    setEndingId(null)
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

  const openEnd = (block) => {
    setBlockOpen(false)
    setEndingId(block.id)
    setEndValues(EMPTY_END)
    setEndErrors({})
    setBanner(null)
    setSuccess(null)
  }

  const closeEnd = () => {
    setEndingId(null)
    setEndErrors({})
  }

  // Remove acts at once: the criteria ask for no confirmation. Whether the
  // block may still be removed is the API's rule; a refusal shows in the banner.
  const handleRemove = async (block) => {
    setBanner(null)
    setSuccess(null)
    setSubmitting(true)
    try {
      await removeVenueBlock(id, block.id)
      setBlocks((current) => current.filter((other) => other.id !== block.id))
      setSuccess('Block removed')
    } catch (error) {
      setBanner(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  // As for the block form, the page checks only that the fields are filled;
  // the time rules are the API's (ui-guidelines.md §5).
  const handleEnd = async (event) => {
    event.preventDefault()
    setBanner(null)
    setSuccess(null)
    const errors = {}
    for (const field of END_FIELDS) {
      if (!endValues[field.name].trim()) errors[field.name] = `${field.label} is required`
    }
    setEndErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    try {
      const updated = await endVenueBlock(id, endingId, endValues)
      // The start is unchanged, so the row keeps its place; sorting keeps the API's order regardless.
      setBlocks((current) =>
        current.map((other) => (other.id === updated.id ? updated : other)).sort(byStartThenId),
      )
      setEndingId(null)
      setSuccess('Block ended')
    } catch (error) {
      setBanner(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  const ending = blocks.find((block) => block.id === endingId)

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
                        {canBlock && <th>Actions</th>}
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
                          {canBlock && (
                            <td>
                              {block.phase === UPCOMING && (
                                <button
                                  type="button"
                                  disabled={submitting}
                                  onClick={() => handleRemove(block)}
                                  className="btn btn-secondary"
                                  data-testid={`venue-detail-block-remove-button-${block.id}`}
                                >
                                  Remove
                                </button>
                              )}
                              {block.phase === IN_PROGRESS && (
                                <button
                                  type="button"
                                  disabled={submitting}
                                  onClick={() => openEnd(block)}
                                  className="btn btn-secondary"
                                  data-testid={`venue-detail-block-end-button-${block.id}`}
                                >
                                  End early
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {ending && (
              <form onSubmit={handleEnd} noValidate className="card form-card space-y-4">
                <h2 className="section-title">End block early</h2>
                <p className="subtitle">
                  {formatDateTimePeriod(ending.start, ending.end)}: {ending.reason}
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  {END_FIELDS.map((field) => {
                    const inputId = `venue-detail-end-block-${kebab(field.name)}`
                    return (
                      <div key={field.name}>
                        <label htmlFor={inputId} className="label">
                          {field.label} *
                        </label>
                        <input
                          type={field.type}
                          id={inputId}
                          value={endValues[field.name]}
                          onChange={(changed) =>
                            setEndValues((current) => ({ ...current, [field.name]: changed.target.value }))
                          }
                          aria-required="true"
                          className="input"
                          data-testid={`${inputId}-input`}
                        />
                        {endErrors[field.name] && (
                          <p className="field-error" data-testid={`${inputId}-error`}>
                            {endErrors[field.name]}
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
                    onClick={closeEnd}
                    className="btn btn-secondary"
                    data-testid="venue-detail-end-block-cancel-button"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn btn-primary"
                    data-testid="venue-detail-end-block-confirm-button"
                  >
                    End
                  </button>
                </div>
              </form>
            )}
          </section>
        </>
      )}
    </div>
  )
}
