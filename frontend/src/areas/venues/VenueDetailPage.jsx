import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { useAuth } from '../../app/auth'
import {
  TIMING_MISMATCH,
  TIMING_MISMATCH_BADGE,
  TOO_SMALL,
  TOO_SMALL_BADGE,
  formatDateTime,
  formatDateTimePeriod,
  formatPeriod,
  formatTime,
  statusBadgeClass,
} from '../../app/format'
import {
  approveBooking,
  blockVenue,
  endVenueBlock,
  getVenue,
  getVenueOptions,
  listVenueBlocks,
  listVenueBookings,
  listVenueClashes,
  listVenues,
  rejectBooking,
  removeVenueBlock,
  updateVenue,
  updateVenueLayouts,
  updateVenueTimes,
  withdrawBooking,
} from './api'
import Banner from '../../app/Banner'
import { useReveal, useRevealError } from '../../app/reveal'

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
const optionKebab = (value) => value.toLowerCase().replaceAll(' ', '-')

// SCRUM-80: setup and turnaround are durations in whole minutes — '0 minutes',
// '1 minute', '30 minutes'.
const minutes = (value) => `${value} ${value === 1 ? 'minute' : 'minutes'}`

// SCRUM-37: a Requested row is undecided; the Decision cell is blank until
// Approve or Reject is confirmed.
const REQUESTED = 'Requested'
// SCRUM-41: only an Approved booking occupies the venue, so only Approved
// bookings appear in the Occupied periods list.
const APPROVED = 'Approved'
const DECIDE_ACTIONS = {
  approve: { label: 'Approve', send: approveBooking, banner: 'Booking approved', reasonRequired: false },
  reject: { label: 'Reject', send: rejectBooking, banner: 'Booking rejected', reasonRequired: true },
}

// SCRUM-78: rejecting may carry a suggested venue, a suggested period or both.
// The period is three fields that stand or fall together (the API's rule).
const SUGGESTED_PERIOD_FIELDS = [
  { name: 'suggested_date', label: 'Suggested date', type: 'date' },
  { name: 'suggested_start_time', label: 'Suggested start time', type: 'time' },
  { name: 'suggested_end_time', label: 'Suggested end time', type: 'time' },
]
const EMPTY_SUGGESTION = {
  suggested_venue_id: '',
  suggested_date: '',
  suggested_start_time: '',
  suggested_end_time: '',
}

function bookingDecisionText(booking) {
  if (!booking.decision) return ''
  const when = formatDateTime(booking.decided_at)
  const base = `${booking.decision} by ${booking.decided_by} (${when})`
  return booking.decision_reason ? `${base}: ${booking.decision_reason}` : base
}

// The API's order: earliest start first, then id. start is 'YYYY-MM-DDTHH:MM',
// so comparing the strings compares the moments.
const byStartThenId = (a, b) => a.start.localeCompare(b.start) || a.id - b.id

// SCRUM-41: occupied_start is the same wire shape as a block's start, so the
// occupied lists sort the same way.
const byOccupiedThenId = (a, b) =>
  a.occupied_start.localeCompare(b.occupied_start) || a.id - b.id

// SCRUM-41 (review): a list whose reload refused after a successful duration
// save is shown as unavailable — never as its previous results, which would
// read as current — with a Reload control as the recovery path
// (docs/design/ui-guidelines.md §7).
function ListUnavailable({ testId, text, onReload, disabled }) {
  return (
    <div className="card space-y-4">
      <p role="alert" className="banner-error" data-testid={`${testId}-unavailable`}>
        {text}
      </p>
      <button
        type="button"
        disabled={disabled}
        onClick={onReload}
        className="btn btn-secondary"
        data-testid={`${testId}-reload-button`}
      >
        Reload
      </button>
    </div>
  )
}

// SCRUM-31: every field recorded for one venue, or the API refusal.
// SCRUM-40: the venue's blocks, and for Venue Staff an inline form to block
// it for a period with a reason (ui-guidelines.md §7).
// SCRUM-75: an inline form for Venue Staff to update the venue's details.
// SCRUM-79: for Venue Staff, Remove on a block that has not started and End
// early, an inline form for a new end, on a block in progress.
// SCRUM-80: setup time and turnaround time shown for every authorised user,
// and for Venue Staff an inline form to record or change them.
// SCRUM-41: an Occupied periods list for anyone who may view the venue, and a
// Current clashes list for Venue Staff, refreshed after a duration save.
export default function VenueDetailPage() {
  const { id } = useParams()
  const routerLocation = useLocation()
  const { can, account } = useAuth()
  const [row, setRow] = useState(null)
  const [blocks, setBlocks] = useState([])
  const [bookings, setBookings] = useState([])
  // SCRUM-41 AC5: the clashes the venue's recorded durations make right now.
  // Asked for only with venues.edit, so an account without it never sees a
  // refusal for a list that is not its to read.
  const [clashes, setClashes] = useState([])
  // SCRUM-41 (review): a refresh that refuses after a successful duration
  // save marks the lists that fetch feeds unavailable instead of leaving the
  // earlier results on the page as though they were current. One flag per
  // fetch: bookings feeds both the Occupied periods and the Booking requests
  // section, clashes feeds Current clashes. A load that refuses on the way in
  // still shows in the banner, as it always has.
  const [staleLists, setStaleLists] = useState({ bookings: false, clashes: false })
  // SCRUM-41 (review): duration saves refresh the lists after the form has
  // closed, so a second save can start while the first save's refresh is
  // still in flight. Only the latest refresh may apply its results — an
  // older one arriving late would show periods the stored durations no
  // longer make. Bumped per refresh and whenever the venue changes, which
  // also invalidates a refresh still in flight for a venue left behind.
  const refreshSeq = useRef(0)
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)
  // The success banner shows on the page the user lands on after saving
  // (docs/design/ui-guidelines.md §4), and after blocking or updating the venue here.
  const [success, setSuccess] = useState(routerLocation.state?.banner ?? null)
  // The inline form that is open: 'update', 'times' (SCRUM-80), 'layouts',
  // 'block', 'end' (End early on the block endingId), 'decide' (SCRUM-37,
  // on the booking decidingBookingId) or null. One value, so opening
  // any one of them closes the others (ui-guidelines.md §7).
  const [openForm, setOpenForm] = useState(null)
  const [blockValues, setBlockValues] = useState(EMPTY_BLOCK)
  const [blockErrors, setBlockErrors] = useState({})
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
  const [options, setOptions] = useState({ facilities: [], accessibility_features: [], layouts: [] })
  const [layoutOptionsLoaded, setLayoutOptionsLoaded] = useState(false)
  const [layoutValues, setLayoutValues] = useState([])
  const [endingId, setEndingId] = useState(null)
  const [endValues, setEndValues] = useState(EMPTY_END)
  const [endErrors, setEndErrors] = useState({})
  // SCRUM-80: two whole-minute durations, not clock times. Either may be
  // cleared while editing; the API records a blank as 0 (ui-guidelines.md §5).
  const [timesValues, setTimesValues] = useState({ setup_time: 0, turnaround_time: 0 })
  // SCRUM-37: which booking row is being decided, and with which action
  // ('approve' or 'reject'). openForm === 'decide' is what actually shows
  // the inline form, the same one-at-a-time rule as the other inline forms.
  const [decidingBookingId, setDecidingBookingId] = useState(null)
  const [decidingAction, setDecidingAction] = useState(null)
  const [decideReason, setDecideReason] = useState('')
  const [decideReasonError, setDecideReasonError] = useState(null)
  // SCRUM-78: the optional suggestion on the reject form. The venues to choose
  // from load the first time Reject is opened.
  const [suggestion, setSuggestion] = useState(EMPTY_SUGGESTION)
  const [suggestionErrors, setSuggestionErrors] = useState({})
  const [suggestableVenues, setSuggestableVenues] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const canBlock = can('venues.edit')
  const canDecideBookings = can('bookings.decide')
  // SCRUM-77: bookings.edit (Event Coordinator) gates the role; SCRUM-87: whether
  // this account is the assigned coordinator of the row's event is checked
  // per-row below, the API's own rule mirrored here for usability (ADR-002).
  const canWithdraw = can('bookings.edit')
  // SCRUM-41: an event's name links to its request only when the account may
  // open requests; anyone else sees the name as plain text.
  const canViewRequests = can('requests.view')

  // Every inline form opens beside or below its trigger, is brought into view
  // with its first field focused, and a failed required-field check focuses
  // the field it names (ui-guidelines.md §13). A per-row form is keyed to its
  // row, so moving to another row's form reveals that one too.
  const layoutsRef = useReveal(openForm === 'layouts' ? 'layouts' : null)
  const timesRef = useReveal(openForm === 'times' ? 'times' : null)
  const updateRef = useReveal(openForm === 'update' ? 'update' : null)
  useRevealError(updateRef, updateErrors)
  const blockRef = useReveal(openForm === 'block' ? 'block' : null)
  useRevealError(blockRef, blockErrors)
  const endRef = useReveal(openForm === 'end' ? `end-${endingId}` : null)
  const decideRef = useReveal(openForm === 'decide' ? `${decidingAction}-${decidingBookingId}` : null)

  // Keyed to id: a reply for the venue the user has left can
  // arrive after the current one, so a stale reply is ignored
  // (docs/design/frontend.md section 7). Loading a venue also
  // invalidates any duration-save refresh still in flight for the
  // previous venue, and clears unavailable flags the previous venue
  // left behind: what loaded here is current for this venue.
  useEffect(() => {
    let active = true
    refreshSeq.current += 1
    Promise.all([
      getVenue(id),
      listVenueBlocks(id),
      listVenueBookings(id),
      // SCRUM-41 AC5: only Venue Staff (venues.edit) may read the clash list,
      // so only they ask for it.
      canBlock ? listVenueClashes(id) : Promise.resolve([]),
    ])
      .then(([venue, venueBlocks, venueBookings, venueClashes]) => {
        if (active) {
          setRow(venue)
          setBlocks(venueBlocks)
          setBookings(venueBookings)
          setClashes(venueClashes)
          setStaleLists({ bookings: false, clashes: false })
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
  }, [id, canBlock])

  useEffect(() => {
    let active = true
    if (canBlock) {
      Promise.resolve(getVenueOptions?.())
        .then((data) => {
          if (active && data) {
            setOptions({
              facilities: data.facilities ?? [],
              accessibility_features: data.accessibility_features ?? [],
              layouts: data.layouts ?? [],
            })
            setLayoutOptionsLoaded(true)
          }
        })
        .catch((error) => {
          if (active) setBanner(error.message)
        })
    }
    return () => {
      active = false
    }
  }, [canBlock])

  const openBlock = () => {
    setOpenForm('block')
    setBlockValues(EMPTY_BLOCK)
    setBlockErrors({})
    setBanner(null)
    setSuccess(null)
  }

  const closeBlock = () => {
    setOpenForm(null)
    setBlockErrors({})
  }

  const openUpdate = () => {
    setOpenForm('update')
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
    setOpenForm(null)
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
      setOpenForm(null)
      setSuccess('Venue updated')
      // SCRUM-61: a new capacity can set or clear Too small on the booking requests.
      refreshLists()
    } catch (error) {
      setBanner(error.message)
    } finally {
      setSubmitting(false)
    }

  }

  const openLayouts = () => {
    setOpenForm('layouts')
    setLayoutValues(row.layouts ? [...row.layouts] : [])
    setBanner(null)
    setSuccess(null)
  }

  const closeLayouts = () => {
    setOpenForm(null)
  }

  const handleLayouts = async (event) => {
    event.preventDefault()
    setBanner(null)
    setSuccess(null)
    setSubmitting(true)
    try {
      const updated = await updateVenueLayouts(id, { layouts: layoutValues })
      setRow(updated)
      setOpenForm(null)
      setSuccess('Layouts updated')
    } catch (error) {
      setBanner(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  // SCRUM-80: setup time and turnaround time are durations in whole minutes.
  // The fields are pre-filled with the recorded values, so an unrecorded venue
  // opens with 0; clearing a field sends a blank, which the API records as 0.
  const openTimes = () => {
    setOpenForm('times')
    setTimesValues({
      setup_time: row.setup_time,
      turnaround_time: row.turnaround_time,
    })
    setBanner(null)
    setSuccess(null)
  }

  const closeTimes = () => {
    setOpenForm(null)
  }

  // SCRUM-41 AC5: the duration save's refresh, and the recovery path when it
  // refuses. Each list is read on its own, so one refusal marks only the
  // sections that fetch feeds unavailable and leaves the other list current;
  // a list that loads is always the current one. Whichever refresh started
  // last owns the lists: a slower earlier one that finishes late is dropped
  // rather than overwriting newer results.
  const refreshLists = async () => {
    const seq = ++refreshSeq.current
    const [bookingsResult, clashesResult] = await Promise.allSettled([
      listVenueBookings(id),
      listVenueClashes(id),
    ])
    if (seq !== refreshSeq.current) return
    if (bookingsResult.status === 'fulfilled') {
      setBookings(bookingsResult.value)
      setStaleLists((current) => ({ ...current, bookings: false }))
    } else {
      setStaleLists((current) => ({ ...current, bookings: true }))
    }
    if (clashesResult.status === 'fulfilled') {
      setClashes(clashesResult.value)
      setStaleLists((current) => ({ ...current, clashes: false }))
    } else {
      setStaleLists((current) => ({ ...current, clashes: true }))
    }
  }

  // The page sends exactly what was typed; every rule and every refusal,
  // including which field is invalid, belongs to the API and shows in the
  // banner (ui-guidelines.md §5). On a refusal the form stays open with the
  // typed values, and the stored times are untouched because the API
  // validates both before writing either.
  const handleTimes = async (event) => {
    event.preventDefault()
    setBanner(null)
    setSuccess(null)
    setSubmitting(true)
    let updated
    try {
      updated = await updateVenueTimes(id, {
        setup_time: timesValues.setup_time,
        turnaround_time: timesValues.turnaround_time,
      })
    } catch (error) {
      // A save refusal: nothing was written, so the form stays open with the
      // typed values and no success is claimed.
      setBanner(error.message)
      setSubmitting(false)
      return
    }
    // The save landed, so it is acknowledged and the form closes even if the
    // refresh below refuses — that refusal marks lists unavailable; it is not
    // a save failure (ui-guidelines.md §7).
    setRow(updated)
    setOpenForm(null)
    setSuccess('Times updated')
    setSubmitting(false)
    // SCRUM-41 AC5: occupied periods and clashes are derived from these
    // durations at every read, so both lists are read again once the save
    // has landed. Nothing else about the bookings changes (AC5).
    await refreshLists()
  }

  const openEnd = (block) => {
    setOpenForm('end')
    setEndingId(block.id)
    setEndValues(EMPTY_END)
    setEndErrors({})
    setBanner(null)
    setSuccess(null)
  }

  const closeEnd = () => {
    setOpenForm(null)
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
      setOpenForm(null)
      setSuccess('Block ended')
    } catch (error) {
      setBanner(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  const openDecide = (booking, action) => {
    setOpenForm('decide')
    setDecidingBookingId(booking.id)
    setDecidingAction(action)
    setDecideReason('')
    setDecideReasonError(null)
    setSuggestion(EMPTY_SUGGESTION)
    setSuggestionErrors({})
    setBanner(null)
    setSuccess(null)
    if (action === 'reject' && suggestableVenues === null) loadSuggestableVenues()
  }

  // Only active venues can be suggested: a retired one cannot be booked.
  const loadSuggestableVenues = async () => {
    try {
      const venues = (await listVenues()) ?? []
      setSuggestableVenues(venues.filter((venue) => venue.is_active))
    } catch (error) {
      setBanner(error.message)
    }
  }

  const closeDecide = () => {
    setOpenForm(null)
    setDecideReasonError(null)
    setSuggestionErrors({})
  }

  const setSuggestionValue = (name, value) => setSuggestion((current) => ({ ...current, [name]: value }))


  // Reason is required to reject, optional to approve, the same rule as
  // deciding an event request (request-detail's decide form).
  const handleDecide = async (event) => {
    event.preventDefault()
    const action = DECIDE_ACTIONS[decidingAction]
    const reasonMissing = action.reasonRequired && decideReason.trim() === ''
    // The page checks only that a period is whole; every other rule about the
    // suggestion is the API's and shows in the banner (ui-guidelines.md §5).
    const rejecting = decidingAction === 'reject'
    const periodGiven = SUGGESTED_PERIOD_FIELDS.filter((field) => suggestion[field.name].trim() !== '')
    const periodIncomplete =
      rejecting && periodGiven.length > 0 && periodGiven.length < SUGGESTED_PERIOD_FIELDS.length
    setDecideReasonError(reasonMissing ? 'Reason is required.' : null)
    setSuggestionErrors(
      periodIncomplete
        ? Object.fromEntries(
            SUGGESTED_PERIOD_FIELDS.filter((field) => suggestion[field.name].trim() === '').map((field) => [
              field.name,
              `${field.label} is required.`,
            ]),
          )
        : {},
    )
    if (reasonMissing || periodIncomplete) return

    // Sent only when something was suggested, so a plain rejection is the same call as before.
    const suggested = Object.fromEntries(
      Object.entries(suggestion)
        .filter(([, value]) => value.trim() !== '')
        .map(([name, value]) => [name, name === 'suggested_venue_id' ? Number(value) : value.trim()]),
    )
    const extra = rejecting && Object.keys(suggested).length > 0 ? [suggested] : []

    setSubmitting(true)
    try {
      const updated = await action.send(id, decidingBookingId, decideReason, ...extra)
      // SCRUM-41: the occupied list is the Approved rows of this same state,
      // so updating the row updates it too — a booking just approved moves in
      // with the occupied period the API sent back (AC1).
      setBookings((current) => current.map((booking) => (booking.id === updated.id ? updated : booking)))
      setOpenForm(null)
      setSuccess(action.banner)
    } catch (error) {
      setBanner(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  // Withdraw acts at once, the same as Remove on a block: the criteria ask
  // for no confirmation.
  const handleWithdraw = async (booking) => {
    setBanner(null)
    setSuccess(null)
    setSubmitting(true)
    try {
      const updated = await withdrawBooking(id, booking.id)
      setBookings((current) => current.map((row) => (row.id === updated.id ? updated : row)))
      setSuccess('Booking withdrawn')
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
      setOpenForm(null)
      setSuccess('Venue blocked')
    } catch (error) {
      setBanner(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  // SCRUM-41 AC2: the availability list — every Approved booking with the
  // occupied period the API derived from the venue's durations, earliest
  // first. Derived from the bookings above, so approving one brings it in and
  // a duration save's refresh moves them all together.
  const occupied = bookings.filter((booking) => booking.status === APPROVED).sort(byOccupiedThenId)

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link to="/venues" className="back-link" data-testid="venue-detail-back-link">
          Back to Venues
        </Link>
        <div className="page-header flex flex-wrap items-center justify-between gap-2">
          <h1 className="page-title" data-testid="venue-detail-title">
            Venue
          </h1>
          <Link to={`/venues/${id}/availability`} className="btn btn-secondary" data-testid="venue-detail-availability-link">
            View availability
          </Link>
        </div>
      </div>

      <Banner
        page="venue-detail"
        error={banner}
        success={success}
        onDismiss={() => {
          setBanner(null)
          setSuccess(null)
        }}
      />

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
              <div>
                <dt>Supported layouts</dt>
                <dd data-testid="venue-detail-layouts-value">{list(row.layouts)}</dd>
              </div>
              {/* SCRUM-80: durations in whole minutes; an unrecorded venue reads 0. */}
              <div>
                <dt>Setup time</dt>
                <dd data-testid="venue-detail-setup-time">{minutes(row.setup_time)}</dd>
              </div>
              <div>
                <dt>Turnaround time</dt>
                <dd data-testid="venue-detail-turnaround-time">{minutes(row.turnaround_time)}</dd>
              </div>
            </dl>
          </div>

          <section className="card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="section-title">Supported layouts</h2>
              {canBlock && layoutOptionsLoaded && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={openLayouts}
                  className="btn btn-secondary"
                  data-testid="venue-detail-layouts-button"
                >
                  Select layouts
                </button>
              )}
            </div>
            {openForm === 'layouts' && (
              <form ref={layoutsRef} onSubmit={handleLayouts} noValidate className="space-y-4">
                <fieldset>
                  <legend className="label">Supported layouts</legend>
                  {options.layouts.map((option) => (
                    <label key={option} className="flex items-center gap-2 py-1">
                      <input
                        type="checkbox"
                        checked={layoutValues.includes(option)}
                        onChange={() =>
                          setLayoutValues((current) =>
                            current.includes(option)
                              ? current.filter((item) => item !== option)
                              : [...current, option],
                          )
                        }
                        data-testid={`venue-detail-layouts-${optionKebab(option)}-input`}
                      />
                      {option}
                    </label>
                  ))}
                </fieldset>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={closeLayouts}
                    className="btn btn-secondary"
                    data-testid="venue-detail-layouts-cancel-button"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn btn-primary"
                    data-testid="venue-detail-layouts-save-button"
                  >
                    Save
                  </button>
                </div>
              </form>
            )}
          </section>

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
                onClick={openTimes}
                className="btn btn-secondary"
                data-testid="venue-detail-times-button"
              >
                Edit times
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

          {openForm === 'times' && (
            <form ref={timesRef} onSubmit={handleTimes} noValidate className="card form-card space-y-4">
              <h2 className="section-title">Edit times</h2>
              <p className="subtitle">Setup time and turnaround time are durations in whole minutes.</p>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="venue-detail-times-setup-time" className="label">
                    Setup time (minutes)
                  </label>
                  <input
                    id="venue-detail-times-setup-time"
                    type="number"
                    min="0"
                    step="1"
                    value={timesValues.setup_time}
                    onChange={(event) =>
                      setTimesValues((current) => ({ ...current, setup_time: event.target.value }))
                    }
                    className="input"
                    data-testid="venue-detail-times-setup-time-input"
                  />
                </div>
                <div>
                  <label htmlFor="venue-detail-times-turnaround-time" className="label">
                    Turnaround time (minutes)
                  </label>
                  <input
                    id="venue-detail-times-turnaround-time"
                    type="number"
                    min="0"
                    step="1"
                    value={timesValues.turnaround_time}
                    onChange={(event) =>
                      setTimesValues((current) => ({ ...current, turnaround_time: event.target.value }))
                    }
                    className="input"
                    data-testid="venue-detail-times-turnaround-time-input"
                  />
                </div>
              </div>
              <p className="subtitle" data-testid="venue-detail-times-hint">
                Leave blank for 0 minutes.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={closeTimes}
                  className="btn btn-secondary"
                  data-testid="venue-detail-times-cancel-button"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary"
                  data-testid="venue-detail-times-save-button"
                >
                  Save
                </button>
              </div>
            </form>
          )}

          {openForm === 'update' && (
            <form ref={updateRef} onSubmit={handleUpdate} noValidate className="card form-card space-y-4">
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

          {openForm === 'block' && (
            <form ref={blockRef} onSubmit={handleBlock} noValidate className="card form-card space-y-4">
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

          {/* SCRUM-41 AC2: what the venue is actually held for, one row per
              Approved booking, its occupied period beside the event name.
              (Review: unavailable instead of its previous rows when the
              reload after a duration save refused.) */}
          <section className="space-y-4">
            <h2 className="section-title">Occupied periods</h2>
            {staleLists.bookings ? (
              <ListUnavailable
                testId="venue-detail-occupied"
                text="The occupied periods could not be reloaded after the times were saved."
                onReload={refreshLists}
                disabled={submitting}
              />
            ) : occupied.length === 0 ? (
              <div className="card">
                <p className="empty-state" data-testid="venue-detail-occupied-empty">
                  This venue has no approved bookings.
                </p>
              </div>
            ) : (
              <div className="card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>Occupied period</th>
                      </tr>
                    </thead>
                    <tbody>
                      {occupied.map((booking) => (
                        <tr key={booking.id} data-testid={`venue-detail-occupied-row-${booking.id}`}>
                          <td data-testid={`venue-detail-occupied-event-${booking.id}`}>
                            {canViewRequests ? (
                              <Link to={`/requests/${booking.event_request_id}`}>
                                {booking.event_request_name}
                              </Link>
                            ) : (
                              booking.event_request_name
                            )}
                          </td>
                          <td data-testid={`venue-detail-occupied-period-${booking.id}`}>
                            {formatDateTimePeriod(booking.occupied_start, booking.occupied_end)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* SCRUM-41 AC5: what the venue's recorded durations make clash right
              now. Venue Staff only (venues.edit) — the ones who change them.
              canBlock is that same feature key. (Review: unavailable instead
              of the previous rows — or the empty state, which would claim
              nothing clashes — when the reload after a save refused.) */}
          {canBlock && (
            <section className="space-y-4">
              <h2 className="section-title">Current clashes</h2>
              {staleLists.clashes ? (
                <ListUnavailable
                  testId="venue-detail-clashes"
                  text="The current clashes could not be reloaded after the times were saved."
                  onReload={refreshLists}
                  disabled={submitting}
                />
              ) : clashes.length === 0 ? (
                <div className="card">
                  <p className="empty-state" data-testid="venue-detail-clashes-empty">
                    No approved bookings currently clash.
                  </p>
                </div>
              ) : (
                <div className="card p-0 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Event</th>
                          <th>Occupied period</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...clashes].sort(byOccupiedThenId).map((booking) => (
                          <tr key={booking.id} data-testid={`venue-detail-clash-row-${booking.id}`}>
                            <td data-testid={`venue-detail-clash-event-${booking.id}`}>
                              {canViewRequests ? (
                                <Link to={`/requests/${booking.event_request_id}`}>
                                  {booking.event_request_name}
                                </Link>
                              ) : (
                                booking.event_request_name
                              )}
                            </td>
                            <td data-testid={`venue-detail-clash-period-${booking.id}`}>
                              {formatDateTimePeriod(booking.occupied_start, booking.occupied_end)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
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
                        <Fragment key={block.id}>
                          <tr data-testid={`venue-detail-block-row-${block.id}`}>
                            <td data-testid={`venue-detail-block-period-${block.id}`}>
                              {formatDateTimePeriod(block.start, block.end)}
                            </td>
                            <td
                              className="whitespace-pre-wrap"
                              data-testid={`venue-detail-block-reason-${block.id}`}
                            >
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
                          {openForm === 'end' && endingId === block.id && (
                            <tr>
                              {/* canBlock is always true here: only the Remove/End early
                                  buttons this form answers to are gated by it. */}
                              <td colSpan={3} className="p-0">
                                <form
                                  ref={endRef}
                                  onSubmit={handleEnd}
                                  noValidate
                                  className="form-card space-y-4 m-4"
                                >
                                  <h2 className="section-title">End block early</h2>
                                  <p className="subtitle">
                                    {formatDateTimePeriod(block.start, block.end)}: {block.reason}
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
                                              setEndValues((current) => ({
                                                ...current,
                                                [field.name]: changed.target.value,
                                              }))
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
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* SCRUM-36: booking requests raised against this venue.
              SCRUM-37: Venue Staff decide a Requested one from its row.
              SCRUM-41 (review): fed by the same read as the Occupied periods
              list, so a refused reload marks it unavailable the same way. */}
          <section className="space-y-4">
            <h2 className="section-title">Booking requests</h2>
            {staleLists.bookings ? (
              <ListUnavailable
                testId="venue-detail-bookings"
                text="The booking requests could not be reloaded after the times were saved."
                onReload={refreshLists}
                disabled={submitting}
              />
            ) : bookings.length === 0 ? (
              <div className="card">
                <p className="empty-state" data-testid="venue-detail-bookings-empty">
                  This venue has no booking requests.
                </p>
              </div>
            ) : (
              <div className="card p-0 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>Period</th>
                        <th>Attendance</th>
                        <th>Layout</th>
                        <th>Facilities</th>
                        <th>Status</th>
                        <th>Decision</th>
                        <th>Suggestion</th>
                        {(canDecideBookings || canWithdraw) && <th>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {bookings.map((booking) => (
                        <Fragment key={booking.id}>
                          <tr data-testid={`venue-detail-booking-row-${booking.id}`}>
                            <td data-testid={`venue-detail-booking-event-${booking.id}`}>
                              {booking.event_request_name}
                            </td>
                            <td data-testid={`venue-detail-booking-period-${booking.id}`}>
                              {formatPeriod(booking.date, booking.start_time, booking.end_time)}
                            </td>
                            <td data-testid={`venue-detail-booking-attendance-${booking.id}`}>
                              {booking.attendance}
                            </td>
                            {/* SCRUM-37 AC1: the event's venue requirements are its
                                chosen layout and facilities (SCRUM-42). */}
                            <td data-testid={`venue-detail-booking-layout-${booking.id}`}>
                              {booking.layout ?? 'None'}
                            </td>
                            <td data-testid={`venue-detail-booking-facilities-${booking.id}`}>
                              {list(booking.facilities)}
                            </td>
                            <td>
                              <span
                                className={statusBadgeClass(booking.status)}
                                data-testid={`venue-detail-booking-status-${booking.id}`}
                              >
                                {booking.status}
                              </span>
                              {/* SCRUM-61: derived by the API at every read. */}
                              {booking.too_small && (
                                <span
                                  className={`${TOO_SMALL_BADGE} ml-2`}
                                  data-testid={`venue-detail-booking-too-small-${booking.id}`}
                                >
                                  {TOO_SMALL}
                                </span>
                              )}
                              {booking.timing_mismatch && (
                                <span
                                  className={`${TIMING_MISMATCH_BADGE} ml-2`}
                                  data-testid={`venue-detail-booking-timing-mismatch-${booking.id}`}
                                >
                                  {TIMING_MISMATCH}
                                </span>
                              )}
                            </td>
                            <td
                              className="whitespace-pre-wrap"
                              data-testid={`venue-detail-booking-decision-${booking.id}`}
                            >
                              {bookingDecisionText(booking)}
                            </td>
                            {/* SCRUM-78: what Venue Staff suggested when they rejected, beside the reason. */}
                            <td data-testid={`venue-detail-booking-suggestion-${booking.id}`}>
                              {booking.suggested_venue && (
                                <p>
                                  Venue:{' '}
                                  <span data-testid={`venue-detail-booking-suggested-venue-${booking.id}`}>
                                    {booking.suggested_venue}
                                  </span>
                                </p>
                              )}
                              {booking.suggested_date && (
                                <p>
                                  Period:{' '}
                                  <span data-testid={`venue-detail-booking-suggested-period-${booking.id}`}>
                                    {formatPeriod(
                                      booking.suggested_date,
                                      booking.suggested_start_time,
                                      booking.suggested_end_time,
                                    )}
                                  </span>
                                </p>
                              )}
                            </td>
                            {(canDecideBookings || canWithdraw) && (
                              <td>
                                {booking.status === REQUESTED && (
                                  <div className="flex flex-wrap gap-2">
                                    {canDecideBookings && (
                                      <>
                                        <button
                                          type="button"
                                          disabled={submitting}
                                          onClick={() => openDecide(booking, 'reject')}
                                          className="btn btn-secondary"
                                          data-testid={`venue-detail-booking-reject-button-${booking.id}`}
                                        >
                                          Reject
                                        </button>
                                        <button
                                          type="button"
                                          disabled={submitting}
                                          onClick={() => openDecide(booking, 'approve')}
                                          className="btn btn-primary"
                                          data-testid={`venue-detail-booking-approve-button-${booking.id}`}
                                        >
                                          Approve
                                        </button>
                                      </>
                                    )}
                                    {canWithdraw && booking.assigned_coordinator === account?.username && (
                                      <button
                                        type="button"
                                        disabled={submitting}
                                        onClick={() => handleWithdraw(booking)}
                                        className="btn btn-secondary"
                                        data-testid={`venue-detail-booking-withdraw-button-${booking.id}`}
                                      >
                                        Withdraw
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                            )}
                          </tr>
                          {openForm === 'decide' && decidingBookingId === booking.id && (
                            <tr>
                              {/* canDecideBookings is always true here: only the Approve/Reject
                                  buttons this form answers to are gated by it. */}
                              <td colSpan={9} className="p-0">
                                <form
                                  ref={decideRef}
                                  onSubmit={handleDecide}
                                  noValidate
                                  className="form-card space-y-4 m-4"
                                >
                                  <h2 className="section-title">
                                    {DECIDE_ACTIONS[decidingAction].label} booking request
                                  </h2>
                                  <div>
                                    <label htmlFor="venue-detail-decide-reason" className="label">
                                      {DECIDE_ACTIONS[decidingAction].reasonRequired ? 'Reason *' : 'Reason'}
                                    </label>
                                    <textarea
                                      id="venue-detail-decide-reason"
                                      value={decideReason}
                                      onChange={(event) => setDecideReason(event.target.value)}
                                      aria-required={
                                        DECIDE_ACTIONS[decidingAction].reasonRequired ? 'true' : undefined
                                      }
                                      className="input"
                                      data-testid="venue-detail-decide-reason-input"
                                    />
                                    {decideReasonError && (
                                      <p className="field-error" data-testid="venue-detail-decide-reason-error">
                                        {decideReasonError}
                                      </p>
                                    )}
                                  </div>
                                  {decidingAction === 'reject' && (
                                    <fieldset className="space-y-4">
                                      <legend className="label">Suggest an alternative (optional)</legend>
                                      <div>
                                        <label htmlFor="venue-detail-decide-suggested-venue" className="label">
                                          Suggested venue
                                        </label>
                                        <select
                                          id="venue-detail-decide-suggested-venue"
                                          className="input"
                                          value={suggestion.suggested_venue_id}
                                          onChange={(event) =>
                                            setSuggestionValue('suggested_venue_id', event.target.value)
                                          }
                                          data-testid="venue-detail-decide-suggested-venue-input"
                                        >
                                          <option value="">None</option>
                                          {(suggestableVenues ?? []).map((venue) => (
                                            <option key={venue.id} value={venue.id}>
                                              {venue.name}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                      <div className="grid gap-4 md:grid-cols-3">
                                        {SUGGESTED_PERIOD_FIELDS.map((field) => (
                                          <div key={field.name}>
                                            <label htmlFor={`venue-detail-decide-${field.name}`} className="label">
                                              {field.label}
                                            </label>
                                            <input
                                              id={`venue-detail-decide-${field.name}`}
                                              type={field.type}
                                              className="input"
                                              value={suggestion[field.name]}
                                              onChange={(event) => setSuggestionValue(field.name, event.target.value)}
                                              data-testid={`venue-detail-decide-${kebab(field.name)}-input`}
                                            />
                                            {suggestionErrors[field.name] && (
                                              <p
                                                className="field-error"
                                                data-testid={`venue-detail-decide-${kebab(field.name)}-error`}
                                              >
                                                {suggestionErrors[field.name]}
                                              </p>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </fieldset>
                                  )}
                                  <div className="flex flex-wrap justify-end gap-2">
                                    <button
                                      type="button"
                                      disabled={submitting}
                                      onClick={closeDecide}
                                      className="btn btn-secondary"
                                      data-testid="venue-detail-decide-cancel-button"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="submit"
                                      disabled={submitting}
                                      className="btn btn-primary"
                                      data-testid="venue-detail-decide-confirm-button"
                                    >
                                      {DECIDE_ACTIONS[decidingAction].label}
                                    </button>
                                  </div>
                                </form>
                              </td>
                            </tr>
                          )}
                        </Fragment>
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
