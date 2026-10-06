import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { useAuth } from '../../app/auth'
import { formatDateTimePeriod, formatTime } from '../../app/format'
import { blockVenue, getVenue, getVenueOptions, listVenueBlocks, updateVenue } from './api'

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
const optionKebab = (value) => value.toLowerCase().replaceAll(' ', '-')

// The API's order: earliest start first, then id. start is 'YYYY-MM-DDTHH:MM',
// so comparing the strings compares the moments.
const byStartThenId = (a, b) => a.start.localeCompare(b.start) || a.id - b.id

// SCRUM-31: every field recorded for one venue, or the API refusal.
// SCRUM-40: the venue's blocks, and for Venue Staff an inline form to block
// it for a period with a reason (ui-guidelines.md §7).
// SCRUM-75: an inline form for Venue Staff to update the venue's details.
export default function VenueDetailPage() {
  const { id } = useParams()
  const routerLocation = useLocation()
  const { can } = useAuth()
  const [row, setRow] = useState(null)
  const [blocks, setBlocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)
  // The success banner shows on the page the user lands on after saving
  // (docs/design/ui-guidelines.md §4), and after blocking or updating the venue here.
  const [success, setSuccess] = useState(routerLocation.state?.banner ?? null)
  const [blockOpen, setBlockOpen] = useState(false)
  const [blockValues, setBlockValues] = useState(EMPTY_BLOCK)
  const [blockErrors, setBlockErrors] = useState({})
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updateValues, setUpdateValues] = useState({
    name: '',
    location: '',
    max_capacity: '',
    opening_time: '',
    closing_time: '',
    facilities: [],
    accessibility_features: [],
  })
  const [updateErrors, setUpdateErrors] = useState({})
  const [options, setOptions] = useState({ facilities: [], accessibility_features: [] })
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

  useEffect(() => {
    let active = true
    if (canBlock) {
      Promise.resolve(getVenueOptions?.())
        .then((data) => {
          if (active && data) {
            setOptions({
              facilities: data.facilities ?? [],
              accessibility_features: data.accessibility_features ?? [],
            })
          }
        })
        .catch(() => {})
    }
    return () => {
      active = false
    }
  }, [canBlock])

  const openBlock = () => {
    setBlockOpen(true)
    setUpdateOpen(false)
    setBlockValues(EMPTY_BLOCK)
    setBlockErrors({})
    setBanner(null)
    setSuccess(null)
  }

  const closeBlock = () => {
    setBlockOpen(false)
    setBlockErrors({})
  }

  const openUpdate = () => {
    setUpdateOpen(true)
    setBlockOpen(false)
    setUpdateValues({
      name: row.name,
      location: row.location,
      max_capacity: row.max_capacity,
      opening_time: row.opening_time ?? '',
      closing_time: row.closing_time ?? '',
      facilities: row.facilities ? [...row.facilities] : [],
      accessibility_features: row.accessibility_features ? [...row.accessibility_features] : [],
    })
    setUpdateErrors({})
    setBanner(null)
    setSuccess(null)
  }

  const closeUpdate = () => {
    setUpdateOpen(false)
    setUpdateErrors({})
  }

  const handleUpdate = async (event) => {
    event.preventDefault()
    setBanner(null)
    setSuccess(null)
    const errors = {}
    if (!updateValues.name.trim()) errors.name = 'Name is required'
    if (!updateValues.location.trim()) errors.location = 'Location is required'
    if (!String(updateValues.max_capacity).trim()) errors['max-capacity'] = 'Maximum capacity is required'
    setUpdateErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    try {
      const updated = await updateVenue(id, {
        name: updateValues.name.trim(),
        location: updateValues.location.trim(),
        max_capacity: updateValues.max_capacity,
        opening_time: updateValues.opening_time,
        closing_time: updateValues.closing_time,
        facilities: updateValues.facilities,
        accessibility_features: updateValues.accessibility_features,
      })
      setRow(updated)
      setUpdateOpen(false)
      setSuccess('Venue updated')
    } catch (error) {
      setBanner(error.message)
    } finally {
      setSubmitting(false)
    }
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
                onClick={openUpdate}
                className="btn btn-secondary"
                data-testid="venue-detail-update-button"
              >
                Update venue
              </button>
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

          {updateOpen && (
            <form onSubmit={handleUpdate} noValidate className="card form-card space-y-4">
              <h2 className="section-title">Update venue</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label htmlFor="venue-detail-update-name" className="label">
                    Name *
                  </label>
                  <input
                    id="venue-detail-update-name"
                    type="text"
                    value={updateValues.name}
                    onChange={(event) =>
                      setUpdateValues((current) => ({ ...current, name: event.target.value }))
                    }
                    aria-required="true"
                    className="input"
                    data-testid="venue-detail-update-name-input"
                  />
                  {updateErrors.name && (
                    <p className="field-error" data-testid="venue-detail-update-name-error">
                      {updateErrors.name}
                    </p>
                  )}
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="venue-detail-update-location" className="label">
                    Location *
                  </label>
                  <input
                    id="venue-detail-update-location"
                    type="text"
                    value={updateValues.location}
                    onChange={(event) =>
                      setUpdateValues((current) => ({ ...current, location: event.target.value }))
                    }
                    aria-required="true"
                    className="input"
                    data-testid="venue-detail-update-location-input"
                  />
                  {updateErrors.location && (
                    <p className="field-error" data-testid="venue-detail-update-location-error">
                      {updateErrors.location}
                    </p>
                  )}
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="venue-detail-update-max-capacity" className="label">
                    Maximum capacity *
                  </label>
                  <input
                    id="venue-detail-update-max-capacity"
                    type="number"
                    value={updateValues.max_capacity}
                    onChange={(event) =>
                      setUpdateValues((current) => ({ ...current, max_capacity: event.target.value }))
                    }
                    aria-required="true"
                    className="input"
                    data-testid="venue-detail-update-max-capacity-input"
                  />
                  {updateErrors['max-capacity'] && (
                    <p className="field-error" data-testid="venue-detail-update-max-capacity-error">
                      {updateErrors['max-capacity']}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="venue-detail-update-opening-time" className="label">
                    Opening time
                  </label>
                  <input
                    id="venue-detail-update-opening-time"
                    type="time"
                    value={updateValues.opening_time}
                    onChange={(event) =>
                      setUpdateValues((current) => ({ ...current, opening_time: event.target.value }))
                    }
                    className="input"
                    data-testid="venue-detail-update-opening-time-input"
                  />
                </div>

                <div>
                  <label htmlFor="venue-detail-update-closing-time" className="label">
                    Closing time
                  </label>
                  <input
                    id="venue-detail-update-closing-time"
                    type="time"
                    value={updateValues.closing_time}
                    onChange={(event) =>
                      setUpdateValues((current) => ({ ...current, closing_time: event.target.value }))
                    }
                    className="input"
                    data-testid="venue-detail-update-closing-time-input"
                  />
                </div>

                <fieldset className="md:col-span-2">
                  <legend className="label">Facilities</legend>
                  {options.facilities.map((option) => (
                    <label key={option} className="flex items-center gap-2 py-1">
                      <input
                        type="checkbox"
                        checked={updateValues.facilities.includes(option)}
                        onChange={() =>
                          setUpdateValues((current) => ({
                            ...current,
                            facilities: current.facilities.includes(option)
                              ? current.facilities.filter((item) => item !== option)
                              : [...current.facilities, option],
                          }))
                        }
                        data-testid={`venue-detail-update-facilities-${optionKebab(option)}-input`}
                      />
                      {option}
                    </label>
                  ))}
                </fieldset>

                <fieldset className="md:col-span-2">
                  <legend className="label">Accessibility features</legend>
                  {options.accessibility_features.map((option) => (
                    <label key={option} className="flex items-center gap-2 py-1">
                      <input
                        type="checkbox"
                        checked={updateValues.accessibility_features.includes(option)}
                        onChange={() =>
                          setUpdateValues((current) => ({
                            ...current,
                            accessibility_features: current.accessibility_features.includes(option)
                              ? current.accessibility_features.filter((item) => item !== option)
                              : [...current.accessibility_features, option],
                          }))
                        }
                        data-testid={`venue-detail-update-accessibility-features-${optionKebab(option)}-input`}
                      />
                      {option}
                    </label>
                  ))}
                </fieldset>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={closeUpdate}
                  className="btn btn-secondary"
                  data-testid="venue-detail-update-cancel-button"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary"
                  data-testid="venue-detail-update-save-button"
                >
                  Save
                </button>
              </div>
            </form>
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
