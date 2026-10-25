import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useAuth } from '../../app/auth'
import { STATUS, formatDate, formatDateTime, formatTime, statusBadgeClass } from '../../app/format'
import ClarificationSection, { AskClarificationForm } from './ClarificationSection'
import SafetyCheckSection from './SafetyCheckSection'
import CompletionSection from './CompletionSection'
import CancellationSection from './CancellationSection'
import PlaceHoldForm from './PlaceHoldForm'
import VenueBookingsSection from './VenueBookingsSection'
import VenueHoldsSection from './VenueHoldsSection'
import VenuesSection from './VenuesSection'
import {
  approveRequest,
  approveSafetyCheck,
  cancelBooking,
  deleteDraft,
  getRequest,
  getRequestOptions,
  listBookings,
  listHolds,
  listVenues,
  placeHold,
  rejectRequest,
  releaseHold,
  rejectSafetyCheck,
  replyToClarification,
  requestClarification,
  requestSafetyChanges,
  resubmitRequest,
  sendForSafetyCheck,
  submitDraft,
  updateDraft,
  withdrawBooking,
} from './api'
import Banner from '../../app/Banner'
import { useReveal, useRevealError } from '../../app/reveal'

// SCRUM-27: show one request or the API refusal (banner), never invent data.
// SCRUM-28: show the success banner carried from RequestNewPage's navigate(),
// and let the Draft's owner submit it (state-model.md: 'Draft -> Submitted').
// SCRUM-29: every submitted field, the submission date and organiser, and the
// decision; an Event Coordinator approves or rejects a Submitted request
// through an inline reason form (ui-guidelines.md §7).
// SCRUM-36: for an Approved or Planning event, an Event Coordinator may
// request a venue booking; it links to the bookings area's own page
// (docs/design/frontend.md §2) rather than an inline form.
// SCRUM-42: the chosen required layout, facilities and accessibility features,
// shown as on the venue page ("None" when empty), and chosen in the Draft edit
// form. They replace the brief's free-text venue requirements and
// accessibility needs, so they sit where those were, under the brief's two headings.
// SCRUM-86: the Event Coordinator Lead assigns a coordinator from the queue; the
// assigned coordinator, the Lead and the date are shown to everyone who can see
// the request. Approving assigns no one. There is no control to decline or change
// it here (SCRUM-44).
// SCRUM-33: for the same two statuses, an Event Coordinator may also search the
// venues free for the event; that page belongs to the venues area.
// SCRUM-72: the Organiser who created a Rejected request revises it in a form
// that is already open and resubmits it (state-model.md: 'Rejected -> Submitted').
// SCRUM-89: a Safety Officer opening an event in Safety Check sees its Approved
// bookings and equipment, adds a note per area and approves or rejects it; the
// decision then sends them back to Requests, where the event has left the list.
// An Event Coordinator sees the decisions made on the event.
// SCRUM-90: the Safety Officer may instead request changes (a reason and the
// areas to change); the coordinator then sees them while the event is in
// Planning, until it is sent for safety check again.
// SCRUM-53: the event's assigned Event Coordinator sends a Planning event for
// safety check; a refusal lists what is outstanding, and the date and time it
// was sent is shown once it is in Safety Check.
// SCRUM-84: everyone who may view venues sees the event's Venue holds; its
// assigned Event Coordinator places a hold from there while the event is
// Approved or Planning (placing the first moves an Approved event to
// Planning), and releases a Held one.
// SCRUM-83: one Venues section holds the event's booking requests and its
// holds, with Search venues, Place hold and Request venue booking at its top.
// The assigned coordinator cancels an Approved booking there with a reason,
// while the event is Approved or Planning, and the coordinator who raised a
// Requested one withdraws it (SCRUM-77).

// Same order and labels as RequestNewPage's form (ui-guidelines.md §7): FIELDS
// come before the Venue requirements and Accessibility needs groups,
// FIELDS_AFTER_CHOICES after them.
const FIELDS = [
  { name: 'name', label: 'Event name' },
  { name: 'purpose', label: 'Purpose' },
  { name: 'description', label: 'Description' },
  { name: 'date', label: 'Date', format: formatDate },
  { name: 'start_time', label: 'Start time', format: formatTime },
  { name: 'end_time', label: 'End time', format: formatTime },
  { name: 'attendance', label: 'Expected attendance' },
]

const FIELDS_AFTER_CHOICES = [
  { name: 'equipment_requirements', label: 'Equipment requirements' },
  { name: 'registration_needs', label: 'Registration needs' },
]

const DECISIONS = {
  approve: { label: 'Approve', send: approveRequest, banner: 'Request approved', reasonRequired: false },
  reject: { label: 'Reject', send: rejectRequest, banner: 'Request rejected', reasonRequired: true },
}

const testId = (name) => `request-detail-${name.replaceAll('_', '-')}`

// A Draft may be saved with fields still empty, so format only what is there.
const show = (value, format) => (value == null || value === '' ? '' : format ? format(value) : value)
// SCRUM-30: the Draft's owner may also edit any field (including the name)
// or permanently delete it. Split around the SCRUM-42 groups as above.
const EDIT_FIELDS_BEFORE_CHOICES = [
  { name: 'name', label: 'Event name', type: 'text' },
  { name: 'purpose', label: 'Purpose', type: 'text' },
  { name: 'description', label: 'Description', type: 'textarea' },
  { name: 'date', label: 'Date', type: 'date' },
  { name: 'start_time', label: 'Start time', type: 'time' },
  { name: 'end_time', label: 'End time', type: 'time' },
  { name: 'attendance', label: 'Expected attendance', type: 'number' },
]

const EDIT_FIELDS_AFTER_CHOICES = [
  { name: 'equipment_requirements', label: 'Equipment requirements', type: 'textarea' },
  { name: 'registration_needs', label: 'Registration needs', type: 'textarea' },
]

const EDIT_FIELDS = [...EDIT_FIELDS_BEFORE_CHOICES, ...EDIT_FIELDS_AFTER_CHOICES]

// Short fields share a row of three from tablet up; every other field takes
// the whole row (docs/design/visual-style.md, Form card).
const SHORT = new Set(['date', 'start_time', 'end_time', 'attendance'])

const editValuesFrom = (row) =>
  Object.fromEntries(EDIT_FIELDS.map((field) => [field.name, row[field.name] ?? '']))

// The edit and resubmit forms start from the same values: the fields, the
// layout ('' when none) and the two lists.
const formValuesFrom = (row) => ({
  ...editValuesFrom(row),
  layout: row.layout ?? '',
  facilities: row.facilities,
  accessibility_features: row.accessibility_features,
})

const list = (values) => (values.length > 0 ? values.join(', ') : 'None')

// The test id of one checkbox is the option's name in kebab-case
// (docs/design/ui-guidelines.md §5).
const kebab = (value) => value.toLowerCase().replaceAll(' ', '-')

const toggle = (values, value) =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value]

export default function RequestDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  const { can, account } = useAuth() ?? {}
  const navigate = useNavigate()
  const [row, setRow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)
  const [successBanner, setSuccessBanner] = useState(location.state?.banner ?? null)
  const [submitting, setSubmitting] = useState(false)
  // Only one inline form open at a time (ui-guidelines.md §7).
  const [openAction, setOpenAction] = useState(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState(null)
  const [editValues, setEditValues] = useState(null)
  const [editError, setEditError] = useState(null)
  const [options, setOptions] = useState(null)
  const [resubmitValues, setResubmitValues] = useState(null)
  const [resubmitErrors, setResubmitErrors] = useState({})
  const [holds, setHolds] = useState(null)
  const [holdVenues, setHoldVenues] = useState([])
  // SCRUM-82 AC6: venue search's Place hold opens the form with its venue chosen.
  const [holdVenueId, setHoldVenueId] = useState('')
  const [bookings, setBookings] = useState(null)
  const [cancellingId, setCancellingId] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelError, setCancelError] = useState(null)

  const isCancelled = row?.status === STATUS.REQUEST.CANCELLED

  // Keyed to id: a reply for the request the user has left can
  // arrive after the current one, so a stale reply is ignored
  // (docs/design/frontend.md section 7).
  useEffect(() => {
    let active = true
    getRequest(id)
      .then((data) => {
        if (active) setRow(data)
      })
      .catch((error) => {
        if (active) {
          setBanner(error.message)
          setSuccessBanner(null)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [id])

  const handleSubmitDraft = async () => {
    setSubmitting(true)
    try {
      const updated = await submitDraft(id)
      setRow(updated)
      setBanner(null)
      setSuccessBanner('Request submitted')
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
    } finally {
      setSubmitting(false)
    }
  }

const openDecision = (action) => {
    setOpenAction(action)
    setReason('')
    setReasonError(null)
    setBanner(null)
    setSuccessBanner(null)
  }

  const closeDecision = () => {
    setOpenAction(null)
    setReason('')
    setReasonError(null)
  }

  const handleConfirmDecision = async (event) => {
    event.preventDefault()
    const decision = DECISIONS[openAction]
    if (decision.reasonRequired && reason.trim() === '') {
      setReasonError('Reason is required.')
      return
    }
    setReasonError(null)

    setSubmitting(true)
    try {
      const updated = await decision.send(id, reason)
      setRow(updated)
      setBanner(null)
      setSuccessBanner(decision.banner)
      closeDecision()
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
      closeDecision()
      // The refusal may mean someone else decided first (AC7): show the
      // request as it now stands, the existing decision and its date included.
      try {
        setRow(await getRequest(id))
      } catch (reloadError) {
        setBanner(reloadError.message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  // SCRUM-87 AC3: only the assigned coordinator decides; the API refuses anyone else.
  const canDecide =
    Boolean(can?.('requests.decide')) &&
    row?.status === STATUS.REQUEST.SUBMITTED &&
    row?.assigned_coordinator === account?.username

  // Every form an action opens is brought into view with its first field
  // focused, and a failed required-field check focuses the field it names
  // (ui-guidelines.md §13).
  const editRef = useReveal(openAction === 'edit' ? 'edit' : null)
  useRevealError(editRef, editError)
  const deleteRef = useReveal(openAction === 'delete' ? 'delete' : null, 'button')
  const decisionRef = useReveal(canDecide && ['approve', 'reject'].includes(openAction) ? openAction : null)
  const resubmitRef = useRef(null)
  useRevealError(resubmitRef, resubmitErrors)

  // SCRUM-53: offered to the assigned coordinator only; the API refuses anyone else.
  const canSend =
    Boolean(can?.('safety.send')) &&
    row?.status === STATUS.REQUEST.PLANNING &&
    row?.assigned_coordinator === account?.username

  // SCRUM-45: the assigned coordinator asks, beside Approve and Reject, while the request
  // is Submitted and none is open; the Organiser who wrote it answers the open one. The
  // API refuses anything else.
  const canAskClarification = canDecide && !row?.clarification_requested
  const canReplyClarification =
    Boolean(can?.('clarifications.reply')) &&
    Boolean(row?.clarification_requested) &&
    row?.created_by === account?.username

  // Each answers true when it went through. A refusal shows in the banner and the
  // request is read again, since it may mean the other side acted first (another tab).
  const handleClarification = (send, banner) => async (message) => {
    setSubmitting(true)
    try {
      setRow(await send(id, message))
      setBanner(null)
      setSuccessBanner(banner)
      return true
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
      try {
        setRow(await getRequest(id))
      } catch (reloadError) {
        setBanner(reloadError.message)
      }
      return false
    } finally {
      setSubmitting(false)
    }
  }
  const handleAskClarification = handleClarification(requestClarification, 'Clarification requested')
  const handleReplyToClarification = handleClarification(replyToClarification, 'Reply sent')

  const handleSend = async () => {
    setSubmitting(true)
    try {
      const updated = await sendForSafetyCheck(id)
      setRow(updated)
      setBanner(null)
      setSuccessBanner('Sent for safety check')
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
      // The refusal may mean it was already sent (another tab): show it as it now stands.
      try {
        setRow(await getRequest(id))
      } catch (reloadError) {
        setBanner(reloadError.message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  // SCRUM-89: the Safety Officer's decision, then back to the list with the outcome.
  const handleSafetyDecision = async (send, banner) => {
    setSubmitting(true)
    try {
      await send()
      navigate('/requests', { state: { banner: `${row.name}: ${banner}` } })
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
      setSubmitting(false)
    }
  }
  const handleSafetyApprove = (notes) =>
    handleSafetyDecision(() => approveSafetyCheck(id, notes), 'approved, now Confirmed')
  const handleSafetyReject = (reasonText, notes) =>
    handleSafetyDecision(() => rejectSafetyCheck(id, reasonText, notes), 'rejected, back in Planning')
  const handleSafetyRequestChanges = (reasonText, areas, notes) =>
    handleSafetyDecision(
      () => requestSafetyChanges(id, reasonText, areas, notes),
      'changes requested, back in Planning',
    )
  // SCRUM-84, SCRUM-83: the holds and bookings are read with venues.view; a Draft can have neither.
  const canSeeHolds = Boolean(can?.('venues.view')) && Boolean(row) && row.status !== STATUS.REQUEST.DRAFT
  // Offered to the assigned coordinator only; the API refuses anyone else.
  const isAssignedCoordinator =
    Boolean(can?.('bookings.edit')) && row?.assigned_coordinator === account?.username
  const canPlaceHold =
    isAssignedCoordinator && [STATUS.REQUEST.APPROVED, STATUS.REQUEST.PLANNING].includes(row?.status)

  // Keyed to id, like the request itself (docs/design/frontend.md section 7).
  useEffect(() => {
    if (!canSeeHolds) return undefined
    let active = true
    listHolds(id)
      .then((data) => {
        if (active) setHolds(data)
      })
      .catch((error) => {
        if (active) {
          setBanner(error.message)
          setSuccessBanner(null)
        }
      })
    return () => {
      active = false
    }
  }, [id, canSeeHolds, isCancelled])

  // SCRUM-83: read like the holds, keyed to id.
  useEffect(() => {
    if (!canSeeHolds) return undefined
    let active = true
    listBookings(id)
      .then((data) => {
        if (active) setBookings(data)
      })
      .catch((error) => {
        if (active) {
          setBanner(error.message)
          setSuccessBanner(null)
        }
      })
    return () => {
      active = false
    }
  }, [id, canSeeHolds, isCancelled])

  // SCRUM-83 AC3: offered on an Approved booking to the assigned coordinator
  // while the event is Approved or Planning; the API refuses anything else.
  const canCancelBooking = (booking) => canPlaceHold && booking.status === STATUS.BOOKING.APPROVED
  // SCRUM-87 AC4: the assigned coordinator may withdraw a Requested booking, whoever raised it.
  const canWithdrawBooking = (booking) =>
    isAssignedCoordinator && !isCancelled && booking.status === STATUS.BOOKING.REQUESTED

  const openCancel = (bookingId) => {
    setOpenAction('cancel')
    setCancellingId(bookingId)
    setCancelReason('')
    setCancelError(null)
    setBanner(null)
    setSuccessBanner(null)
  }

  const closeCancel = () => {
    setOpenAction(null)
    setCancellingId(null)
  }

  // AC4: a blank reason is refused here and nothing is sent (§13 pattern C);
  // a refusal from the API keeps the form open with its reason.
  const handleConfirmCancel = async () => {
    if (cancelReason.trim() === '') {
      setCancelError('Reason is required.')
      return
    }
    setCancelError(null)
    const booking = bookings.find((item) => item.id === cancellingId)
    setSubmitting(true)
    try {
      await cancelBooking(booking.venue_id, booking.id, cancelReason)
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
      setSubmitting(false)
      return
    }
    closeCancel()
    setBanner(null)
    setSuccessBanner('Booking cancelled')
    try {
      setBookings(await listBookings(id))
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
    } finally {
      setSubmitting(false)
    }
  }

  // SCRUM-77's Withdraw, acting at once as on the venue page.
  const handleWithdrawBooking = async (booking) => {
    setSubmitting(true)
    try {
      const updated = await withdrawBooking(booking.venue_id, booking.id)
      setBookings((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      setBanner(null)
      setSuccessBanner('Booking withdrawn')
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
      // The refusal may mean it was already decided: show the bookings as they now stand.
      try {
        setBookings(await listBookings(id))
      } catch (reloadError) {
        setBanner(reloadError.message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  // The venue picker is needed only to place a hold, so it loads when the form opens.
  // SCRUM-82 AC6: presetVenueId chooses the venue; an unknown or retired one
  // is ignored and the form stays closed, so the page opens normally.
  const openHold = async (presetVenueId = '') => {
    setSubmitting(true)
    try {
      const venues = (await listVenues()).filter((venue) => venue.is_active)
      if (presetVenueId && !venues.some((venue) => String(venue.id) === presetVenueId)) return
      setHoldVenues(venues)
      setHoldVenueId(presetVenueId)
      setBanner(null)
      setSuccessBanner(null)
      setOpenAction('hold')
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
    } finally {
      setSubmitting(false)
    }
  }

  // A refusal keeps the form open with its entries (ui-guidelines.md §7).
  const handlePlaceHold = async (values) => {
    setSubmitting(true)
    try {
      const hold = await placeHold(id, values)
      // The form is offered only once the holds are listed, so prev is a list.
      setHolds((prev) => [...prev, hold])
      setOpenAction(null)
      setBanner(null)
      setSuccessBanner('Hold placed')
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
      setSubmitting(false)
      return
    }
    // AC8: the first hold may have moved an Approved event to Planning.
    try {
      setRow(await getRequest(id))
    } catch (error) {
      setBanner(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  // SCRUM-82 AC6: ?hold=<venueId> from venue search opens the form once, as
  // soon as it can be offered: the coordinator may place a hold and the holds are listed.
  const holdFromSearch = new URLSearchParams(location.search).get('hold')
  const holdFromSearchOpened = useRef(false)
  useEffect(() => {
    if (!holdFromSearch || !canPlaceHold || holds === null || holdFromSearchOpened.current) return
    holdFromSearchOpened.current = true
    openHold(holdFromSearch)
  })

  const handleReleaseHold = async (holdId) => {
    setSubmitting(true)
    try {
      const released = await releaseHold(id, holdId)
      setHolds((prev) => prev.map((hold) => (hold.id === released.id ? released : hold)))
      setBanner(null)
      setSuccessBanner('Hold released')
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
      // The refusal may mean it was already released (another tab): show the holds as they now stand.
      try {
        setHolds(await listHolds(id))
      } catch (reloadError) {
        setBanner(reloadError.message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  // SCRUM-87 AC4: raising a booking and searching venues are the assigned coordinator's.
  const canRaiseBooking =
    isAssignedCoordinator && [STATUS.REQUEST.APPROVED, STATUS.REQUEST.PLANNING].includes(row?.status)
  // SCRUM-33: venue search is offered for the same two statuses.
  const canSearchVenues =
    Boolean(can?.('venues.search')) &&
    row?.assigned_coordinator === account?.username &&
    [STATUS.REQUEST.APPROVED, STATUS.REQUEST.PLANNING].includes(row?.status)

  // SCRUM-72: the form is offered to the Organiser who created the request; the
  // API refuses anyone else (403/404) and a request that is not Rejected.
  const canResubmit =
    Boolean(can?.('requests.edit')) &&
    row?.status === STATUS.REQUEST.REJECTED &&
    row?.created_by === account?.username

  // The form is already open, so its lists and starting values load with the page.
  useEffect(() => {
    if (!canResubmit || resubmitValues) return undefined
    let active = true
    getRequestOptions()
      .then((data) => {
        if (!active) return
        setOptions(data)
        setResubmitValues(formValuesFrom(row))
      })
      .catch((error) => {
        if (!active) return
        setBanner(error.message)
        setSuccessBanner(null)
      })
    return () => {
      active = false
    }
  }, [canResubmit, resubmitValues, row])

  const setResubmitValue = (name, value) => setResubmitValues((prev) => ({ ...prev, [name]: value }))

  const handleResubmit = async (event) => {
    event.preventDefault()
    const missing = EDIT_FIELDS.filter((field) => String(resubmitValues[field.name]).trim() === '')
    if (missing.length > 0) {
      setResubmitErrors(Object.fromEntries(missing.map((field) => [field.name, `${field.label} is required.`])))
      setBanner(null)
      return
    }
    setResubmitErrors({})

    setSubmitting(true)
    try {
      const updated = await resubmitRequest(id, { ...resubmitValues, layout: resubmitValues.layout || null })
      setRow(updated)
      setBanner(null)
      setSuccessBanner('Request resubmitted')
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
      // The refusal may mean the request is no longer Rejected (resubmitted
      // from another page): show it as it now stands, entries kept.
      try {
        setRow(await getRequest(id))
      } catch (reloadError) {
        setBanner(reloadError.message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  // The lists are needed only to edit, so they load when Edit is opened.
  const openEdit = async () => {
    setSubmitting(true)
    try {
      setOptions(await getRequestOptions())
      setEditValues(formValuesFrom(row))
      setEditError(null)
      setOpenAction('edit')
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
    } finally {
      setSubmitting(false)
    }
  }

  const setEditValue = (name, value) => setEditValues((prev) => ({ ...prev, [name]: value }))

  const handleEditConfirm = async () => {
    if (String(editValues.name).trim() === '') {
      setEditError('Event name is required.')
      return
    }
    setEditError(null)
    setSubmitting(true)
    try {
      const updated = await updateDraft(id, { ...editValues, layout: editValues.layout || null })
      setRow(updated)
      setBanner(null)
      setSuccessBanner('Draft updated')
      setOpenAction(null)
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteConfirm = async () => {
    setSubmitting(true)
    try {
      await deleteDraft(id)
      navigate('/requests', { state: { banner: 'Draft deleted' } })
    } catch (error) {
      setBanner(error.message)
      setSuccessBanner(null)
      setSubmitting(false)
    }
  }

  const renderValue = (field) => (
    <div key={field.name}>
      <dt>{field.label}</dt>
      <dd className="whitespace-pre-wrap" data-testid={testId(field.name)}>
        {show(row[field.name], field.format)}
      </dd>
    </div>
  )

  // One field of the Draft edit form or of the resubmit form: the same markup,
  // with the action as test id prefix (ui-guidelines.md section 7).
  const renderFormField = (action, values, setValue, errors, required) => (field) => {
    const key = field.name.replaceAll('_', '-')
    const Control = field.type === 'textarea' ? 'textarea' : 'input'
    return (
      <div key={field.name} className={SHORT.has(field.name) ? undefined : 'md:col-span-3'}>
        <label htmlFor={`request-detail-${action}-${field.name}`} className="label">
          {field.label}
          {required ? ' *' : ''}
        </label>
        <Control
          id={`request-detail-${action}-${field.name}`}
          type={field.type === 'textarea' ? undefined : field.type}
          aria-required={required ? 'true' : undefined}
          className="input"
          value={values[field.name]}
          onChange={(event) => setValue(field.name, event.target.value)}
          data-testid={`request-detail-${action}-${key}-input`}
        />
        {errors[field.name] && (
          <p className="field-error" data-testid={`request-detail-${action}-${key}-error`}>
            {errors[field.name]}
          </p>
        )}
      </div>
    )
  }

  const renderCheckboxes = (action, values, setValue, name) =>
    options[name].map((option) => (
      <label key={option} className="flex items-center gap-2 py-1">
        <input
          type="checkbox"
          checked={values[name].includes(option)}
          onChange={() => setValue(name, toggle(values[name], option))}
          data-testid={`request-detail-${action}-${name.replaceAll('_', '-')}-${kebab(option)}-input`}
        />
        {option}
      </label>
    ))

  // The venue and accessibility choices between the two groups of fields, shared
  // by both forms.
  const renderChoices = (action, values, setValue) => (
    <>
      <fieldset className="space-y-4">
        <legend className="section-title">Venue requirements</legend>
        <div>
          <label htmlFor={`request-detail-${action}-layout`} className="label">
            Room layout
          </label>
          <select
            id={`request-detail-${action}-layout`}
            className="input"
            value={values.layout}
            onChange={(event) => setValue('layout', event.target.value)}
            data-testid={`request-detail-${action}-layout-input`}
          >
            <option value="">None</option>
            {options.layouts.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <fieldset>
          <legend className="label">Facilities</legend>
          {renderCheckboxes(action, values, setValue, 'facilities')}
        </fieldset>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="section-title">Accessibility needs</legend>
        <fieldset>
          <legend className="label">Accessibility features</legend>
          {renderCheckboxes(action, values, setValue, 'accessibility_features')}
        </fieldset>
      </fieldset>
    </>
  )

  const renderEditField = renderFormField('edit', editValues ?? {}, setEditValue, editError ? { name: editError } : {}, false)

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Link to="/requests" className="back-link" data-testid="request-detail-back-link">
          Back to Requests
        </Link>
        <div className="page-header">
          <h1 className="page-title" data-testid="request-detail-title">
            Request
          </h1>
        </div>
      </div>

      <Banner
        page="request-detail"
        error={banner}
        success={successBanner}
        onDismiss={() => {
          setBanner(null)
          setSuccessBanner(null)
        }}
      />

      {loading || !row ? null : (
        <div className="card space-y-6">
          <CompletionSection event={row} onCompleted={setRow} activeAction={openAction} onActionChange={setOpenAction} />
          <CancellationSection event={row} onCancelled={setRow} activeAction={openAction} onActionChange={setOpenAction} />
          <dl className="detail-list" data-testid="request-detail-fields">
            {typeof FIELDS !== 'undefined' && FIELDS.map(renderValue)}
          </dl>

          <section className="space-y-3">
            <h2 className="section-title">Venue requirements</h2>
            <dl className="detail-list">
              <div>
                <dt>Room layout</dt>
                <dd data-testid="request-detail-layout">{row.layout ?? 'None'}</dd>
              </div>
              <div>
                <dt>Facilities</dt>
                <dd data-testid="request-detail-facilities">{list(row.facilities)}</dd>
              </div>
            </dl>
          </section>

          <section className="space-y-3">
            <h2 className="section-title">Accessibility needs</h2>
            <dl className="detail-list">
              <div>
                <dt>Accessibility features</dt>
                <dd data-testid="request-detail-accessibility-features">{list(row.accessibility_features)}</dd>
              </div>
            </dl>
          </section>

          <dl className="detail-list">
            {FIELDS_AFTER_CHOICES.map(renderValue)}
            <div>
              <dt>Status</dt>
              <dd data-testid="request-detail-status">
                <span className={statusBadgeClass(row.status)}>{row.status}</span>
                {row.clarification_requested && (
                  <span className="ml-2 text-sm" data-testid="request-detail-clarification-flag">
                    Clarification requested
                  </span>
                )}
              </dd>
            </div>
            {row.safety_check_at &&
              [STATUS.REQUEST.SAFETY_CHECK, STATUS.REQUEST.CONFIRMED].includes(row.status) && (
                <div>
                  <dt>Sent for safety check</dt>
                  <dd data-testid="request-detail-safety-check-at">{formatDateTime(row.safety_check_at)}</dd>
                </div>
              )}
            <div>
              <dt>Created by</dt>
              <dd data-testid="request-detail-created-by">{row.created_by}</dd>
            </div>
            
            {row.submitted_at && (
              <div>
                <dt>Submitted on</dt>
                <dd data-testid="request-detail-submitted-at">{formatDateTime(row.submitted_at)}</dd>
              </div>
            )}
            {row.decision && (
              <>
                <div>
                  <dt>Decision</dt>
                  <dd data-testid="request-detail-decision">{row.decision}</dd>
                </div>
                {row.decision_reason && (
                  <div>
                    <dt>Reason</dt>
                    <dd className="whitespace-pre-wrap" data-testid="request-detail-decision-reason">
                      {row.decision_reason}
                    </dd>
                  </div>
                )}
                {row.decided_at && (
                  <div>
                    <dt>Decided on</dt>
                    <dd data-testid="request-detail-decided-at">{formatDateTime(row.decided_at)}</dd>
                  </div>
                )}
                <div>
                  <dt>Decided by</dt>
                  <dd data-testid="request-detail-decided-by">{row.decided_by}</dd>
                </div>
              </>
            )}

            {/* SCRUM-86: the one Event Coordinator the Lead assigned, who did it and when. */}
            {row.assigned_coordinator && (
              <>
                <div>
                  <dt>Assigned coordinator</dt>
                  <dd data-testid="request-detail-assigned-coordinator">{row.assigned_coordinator}</dd>
                </div>
                {row.assigned_by && (
                  <div>
                    <dt>Assigned by</dt>
                    <dd data-testid="request-detail-assigned-by">{row.assigned_by}</dd>
                  </div>
                )}
                {row.assigned_at && (
                  <div>
                    <dt>Assigned on</dt>
                    <dd data-testid="request-detail-assigned-at">{formatDate(row.assigned_at.slice(0, 10))}</dd>
                  </div>
                )}
              </>
            )}

            {'coordinator_notes' in row && row.coordinator_notes != null && (
              <div>
                <dt>Coordinator notes</dt>
                <dd data-testid="request-detail-coordinator-notes">{row.coordinator_notes}</dd>
              </div>
            )}
          </dl>

          {/* SCRUM-30: a Draft's owner may edit, delete or submit it. */}
          {row.status === STATUS.REQUEST.DRAFT && (
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setOpenAction('delete')}
                className="btn btn-danger"
                data-testid="request-detail-delete-button"
              >
                Delete
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={openEdit}
                className="btn btn-secondary"
                data-testid="request-detail-edit-button"
              >
                Edit
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSubmitDraft}
                className="btn btn-primary"
                data-testid="request-detail-submit-button"
              >
                Submit
              </button>
            </div>
          )}

          {/* SCRUM-53: the assigned coordinator sends a Planning event for safety check. */}
          {canSend && (
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={handleSend}
                className="btn btn-primary"
                data-testid="request-detail-send-safety-button"
              >
                Send for safety check
              </button>
            </div>
          )}

          {/* SCRUM-29: approve or reject a Submitted request, in the card's action row (§7). */}
          {canDecide && (
            <div className="flex flex-wrap justify-end gap-2">
              {canAskClarification && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => openDecision('clarify')}
                  className="btn btn-secondary"
                  data-testid="request-detail-clarification-button"
                >
                  Request clarification
                </button>
              )}
              <button
                type="button"
                disabled={submitting}
                onClick={() => openDecision('reject')}
                className="btn btn-secondary"
                data-testid="request-detail-reject-button"
              >
                Reject
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => openDecision('approve')}
                className="btn btn-primary"
                data-testid="request-detail-approve-button"
              >
                Approve
              </button>
            </div>
          )}
        </div>
      )}

      {/* The forms the card's action rows open sit directly below the card (ui-guidelines.md §13). */}
      {/* SCRUM-45: the message the assigned coordinator sends the Organiser. */}
      {canAskClarification && openAction === 'clarify' && (
        <AskClarificationForm
          submitting={submitting}
          onClose={() => setOpenAction(null)}
          onAsk={handleAskClarification}
        />
      )}

      {/* SCRUM-30: edit any field of an own Draft, including the name. */}
      {openAction === 'edit' && editValues && (
        <div ref={editRef} className="card form-card space-y-4" data-testid="request-detail-edit-form">
          <h2 className="section-title">Edit draft</h2>
          <div className="grid gap-4 md:grid-cols-3">{EDIT_FIELDS_BEFORE_CHOICES.map(renderEditField)}</div>
          {renderChoices('edit', editValues, setEditValue)}
          <div className="grid gap-4 md:grid-cols-3">{EDIT_FIELDS_AFTER_CHOICES.map(renderEditField)}</div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => setOpenAction(null)}
              className="btn btn-secondary"
              data-testid="request-detail-edit-cancel-button"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleEditConfirm}
              className="btn btn-primary"
              data-testid="request-detail-edit-confirm-button"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* SCRUM-30: permanently delete an own Draft. */}
      {openAction === 'delete' && (
        <div ref={deleteRef} className="card space-y-4" data-testid="request-detail-delete-form">
          <h2 className="section-title">Delete draft</h2>
          <p>Delete this draft permanently? This cannot be undone.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => setOpenAction(null)}
              className="btn btn-secondary"
              data-testid="request-detail-delete-cancel-button"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleDeleteConfirm}
              className="btn btn-danger"
              data-testid="request-detail-delete-confirm-button"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {canDecide && ['approve', 'reject'].includes(openAction) && (
        <form ref={decisionRef} onSubmit={handleConfirmDecision} noValidate className="card form-card space-y-4">
          <h2 className="section-title">{DECISIONS[openAction].label} Request</h2>
          <div>
            <label htmlFor={`${openAction}-reason`} className="label">
              {DECISIONS[openAction].reasonRequired ? 'Reason *' : 'Reason'}
            </label>
            <textarea
              id={`${openAction}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-required={DECISIONS[openAction].reasonRequired ? 'true' : undefined}
              className="input"
              data-testid={`request-detail-${openAction}-reason-input`}
            />
            {reasonError && (
              <p className="field-error" data-testid={`request-detail-${openAction}-reason-error`}>
                {reasonError}
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={closeDecision}
              className="btn btn-secondary"
              data-testid={`request-detail-${openAction}-cancel-button`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary"
              data-testid={`request-detail-${openAction}-confirm-button`}
            >
              Confirm
            </button>
          </div>
        </form>
      )}


      {/* SCRUM-83: the event's bookings and holds in one Venues section, with
          SCRUM-33's Search venues, SCRUM-84's Place hold and SCRUM-36's Request
          venue booking at its top. */}
      {!loading && row && (canSeeHolds || canSearchVenues || canRaiseBooking) && (
        <VenuesSection
          requestId={id}
          canSearch={canSearchVenues}
          canRaise={canRaiseBooking}
          canPlaceHold={canPlaceHold}
          holdFormOpen={openAction === 'hold'}
          submitting={submitting}
          onPlaceHold={() => openHold()}
        >
          {canPlaceHold && openAction === 'hold' && (
            <PlaceHoldForm
              venues={holdVenues}
              venueId={holdVenueId}
              submitting={submitting}
              onCancel={() => setOpenAction(null)}
              onPlace={handlePlaceHold}
            />
          )}
          {canSeeHolds && bookings && (
            <VenueBookingsSection
              bookings={bookings}
              canCancel={canCancelBooking}
              canWithdraw={canWithdrawBooking}
              hasActions={isAssignedCoordinator}
              cancellingId={openAction === 'cancel' ? cancellingId : null}
              reason={cancelReason}
              reasonError={cancelError}
              submitting={submitting}
              onOpenCancel={openCancel}
              onReasonChange={setCancelReason}
              onConfirmCancel={handleConfirmCancel}
              onCloseCancel={closeCancel}
              onWithdraw={handleWithdrawBooking}
            />
          )}
          {canSeeHolds && holds && (
            <VenueHoldsSection
              holds={holds}
              canRelease={isAssignedCoordinator && !isCancelled}
              submitting={submitting}
              onRelease={handleReleaseHold}
            />
          )}
        </VenuesSection>
      )}

      {/* SCRUM-45: what the coordinator asked and the Organiser answered. */}
      {!loading && row?.clarifications?.length > 0 && (
        <ClarificationSection
          clarifications={row.clarifications}
          canReply={canReplyClarification}
          submitting={submitting}
          onAsk={handleAskClarification}
          onReply={handleReplyToClarification}
        />
      )}

      {/* SCRUM-89: review an event in Safety Check, and decide it. */}
      {!loading &&
        row &&
        (row.safety_check || row.requested_changes || row.safety_decisions?.length > 0) && (
        <SafetyCheckSection
          decisions={row.safety_decisions}
          safetyCheck={row.safety_check}
          requestedChanges={row.requested_changes}
          canDecide={Boolean(can?.('safety.decide')) && row.status === STATUS.REQUEST.SAFETY_CHECK}
          submitting={submitting}
          onApprove={handleSafetyApprove}
          onReject={handleSafetyReject}
          onRequestChanges={handleSafetyRequestChanges}
        />
      )}

      {/* SCRUM-72: a Rejected request's creator revises it and resubmits. */}
      {!loading && canResubmit && resubmitValues && options && (
        <form
          ref={resubmitRef}
          onSubmit={handleResubmit}
          noValidate
          className="card form-card space-y-4"
          data-testid="request-detail-resubmit-form"
        >
          <h2 className="section-title">Revise and resubmit</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {EDIT_FIELDS_BEFORE_CHOICES.map(
              renderFormField('resubmit', resubmitValues, setResubmitValue, resubmitErrors, true),
            )}
          </div>
          {renderChoices('resubmit', resubmitValues, setResubmitValue)}
          <div className="grid gap-4 md:grid-cols-3">
            {EDIT_FIELDS_AFTER_CHOICES.map(
              renderFormField('resubmit', resubmitValues, setResubmitValue, resubmitErrors, true),
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary"
              data-testid="request-detail-resubmit-button"
            >
              Resubmit
            </button>
          </div>
        </form>
      )}

    </div>
  )
}
