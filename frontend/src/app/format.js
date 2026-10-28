// The only shared functions in the front end (docs/design/frontend.md §1).
// Pages never format a date or type a status word themselves
// (docs/design/ui-guidelines.md §9). No date library: plain string handling,
// so nothing here depends on the browser's locale or time zone.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const HOURS_MINUTES = /^([01]\d|2[0-3]):([0-5]\d)$/

// '2026-10-03' -> '03 Oct 2026'
export function formatDate(iso) {
  const parts = ISO_DATE.exec(String(iso))
  if (!parts) {
    throw new Error(`Not an ISO date (YYYY-MM-DD): ${iso}`)
  }

  const [, year, month, day] = parts
  const monthIndex = Number(month) - 1
  // Date.UTC reads years 0–99 as 1900–1999, which would make every real year
  // below 0100 fail the round-trip below (0001 checks back as 1901). Taking
  // the year with setUTCFullYear instead keeps four-digit years like
  // 0001 valid. It still rolls a date that does not exist forward (31
  // February becomes 3 March), so compare the parts back to reject it.
  const parsed = new Date(0)
  parsed.setUTCFullYear(Number(year), monthIndex, Number(day))

  const rolled =
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== monthIndex ||
    parsed.getUTCDate() !== Number(day)
  if (rolled) {
    throw new Error(`Not a real date: ${iso}`)
  }

  return `${day} ${MONTHS[monthIndex]} ${year}`
}

// '14:30' -> '14:30'. The API already sends 24-hour times, so this validates
// rather than converts; it exists so a page never prints an unchecked value.
export function formatTime(hhmm) {
  const value = String(hhmm)
  if (!HOURS_MINUTES.test(value)) {
    throw new Error(`Not a 24-hour time (HH:MM): ${hhmm}`)
  }
  return value
}

// '2026-10-03', '14:30', '16:00' -> '03 Oct 2026, 14:30–16:00' (en dash)
export function formatPeriod(iso, start, end) {
  return `${formatDate(iso)}, ${formatTime(start)}–${formatTime(end)}`
}

// '2026-09-23T14:05:00' -> '23 Sep 2026, 14:05'. The API stores and sends
// UTC; the time is shown as sent, with no conversion to the browser's zone.
const ISO_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/

export function formatDateTime(iso) {
  const parts = ISO_DATE_TIME.exec(String(iso))
  if (!parts) {
    throw new Error(`Not an ISO date and time (YYYY-MM-DDTHH:MM): ${iso}`)
  }
  return `${formatDate(parts[1])}, ${formatTime(parts[2])}`
}

// '2026-10-20T09:00', '2026-10-21T18:00' -> '20 Oct 2026, 09:00 to 21 Oct 2026, 18:00'.
// A period that may span days (a venue block). Both ends are shown in full,
// even on the same day, and as sent, with no time zone conversion.
export function formatDateTimePeriod(start, end) {
  return `${formatDateTime(start)} to ${formatDateTime(end)}`
}

// Upper snake case of the value: 'Out of Service' -> OUT_OF_SERVICE.
const group = (values) =>
  Object.freeze(
    Object.fromEntries(values.map((value) => [value.toUpperCase().replaceAll(' ', '_'), value])),
  )

// The exact words in docs/design/state-model.md, grouped per record. Changing a
// status name there changes this object in the same pull request.
export const STATUS = Object.freeze({
  REQUEST: group([
    'Draft',
    'Submitted',
    'Approved',
    'Rejected',
    'Planning',
    'Safety Check',
    'Confirmed',
    'Completed',
    'Cancelled',
  ]),
  // SCRUM-83 adds Cancelled: an Approved booking its event's coordinator cancelled.
  BOOKING: group(['Requested', 'Approved', 'Rejected', 'Withdrawn', 'Cancelled']),
  REQUIREMENT: group(['Requested', 'Approved', 'Declined']),
  RESERVATION: group(['Reserved', 'Released']),
  UNIT: group(['In Service', 'Out of Service']),
  REGISTRATION: group(['Registered', 'Withdrawn']),
  // SCRUM-85 adds Expired: a Held hold whose expiry was reached.
  HOLD: group(['Held', 'Released', 'Expired']),
})

// Status -> badge class (docs/design/ui-guidelines.md, Look). Keyed by the
// STATUS constants, never typed words. Colour accompanies the status text; it
// never replaces it. A status without a colour of its own is neutral.
const BADGE = Object.freeze({
  [STATUS.REQUEST.DRAFT]: 'badge-neutral',
  [STATUS.REQUEST.SUBMITTED]: 'badge-info',
  [STATUS.REQUEST.APPROVED]: 'badge-success',
  [STATUS.REQUEST.PLANNING]: 'badge-warning',
  [STATUS.REQUEST.SAFETY_CHECK]: 'badge-warning',
  [STATUS.REQUEST.CONFIRMED]: 'badge-success',
  [STATUS.REQUEST.REJECTED]: 'badge-danger',
  [STATUS.REQUEST.CANCELLED]: 'badge-danger',
  [STATUS.REQUEST.COMPLETED]: 'badge-neutral',
  [STATUS.BOOKING.REQUESTED]: 'badge-info',
  [STATUS.BOOKING.WITHDRAWN]: 'badge-neutral',
  // A booking's Approved, Rejected and Cancelled are the same words as an event
  // request's, so they take the colours above (ui-guidelines.md §12). A
  // requirement's Requested and Approved do the same; Declined is its own word
  // and reads like a Rejected.
  [STATUS.REQUIREMENT.DECLINED]: 'badge-danger',
  // SCRUM-55: a Registered registration is Success; Withdrawn is the booking's neutral Withdrawn above.
  [STATUS.REGISTRATION.REGISTERED]: 'badge-success',
  [STATUS.HOLD.HELD]: 'badge-warning',
  [STATUS.HOLD.RELEASED]: 'badge-neutral',
  // SCRUM-85: Danger, so a lapsed hold reads apart from Held and Released.
  [STATUS.HOLD.EXPIRED]: 'badge-danger',
})

// 'Submitted' -> 'badge badge-info'
export function statusBadgeClass(status) {
  return `badge ${BADGE[status] ?? 'badge-neutral'}`
}

// SCRUM-82: Venue unavailable is a flag on an Approved booking, not a status
// (state-model.md). Its badge is Danger, so it reads apart from the Approved
// badge (Success) beside it (ui-guidelines.md §12).
export const VENUE_UNAVAILABLE = 'Venue unavailable'
export const VENUE_UNAVAILABLE_BADGE = 'badge badge-danger'
