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
  const parsed = new Date(Date.UTC(Number(year), monthIndex, Number(day)))

  // Date.UTC rolls a date that does not exist forward (31 February becomes
  // 3 March), so compare the parts back to reject it.
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
    'Confirmed',
    'Completed',
    'Cancelled',
  ]),
  BOOKING: group(['Requested', 'Approved', 'Rejected', 'Withdrawn']),
  RESERVATION: group(['Reserved', 'Released']),
  UNIT: group(['In Service', 'Out of Service']),
  REGISTRATION: group(['Registered', 'Withdrawn']),
})

// Status -> badge class (docs/design/ui-guidelines.md, Look). Keyed by the
// STATUS constants, never typed words. Colour accompanies the status text; it
// never replaces it. A status without a colour of its own is neutral.
const BADGE = Object.freeze({
  [STATUS.REQUEST.DRAFT]: 'badge-neutral',
  [STATUS.REQUEST.SUBMITTED]: 'badge-info',
  [STATUS.REQUEST.APPROVED]: 'badge-success',
  [STATUS.REQUEST.PLANNING]: 'badge-warning',
  [STATUS.REQUEST.CONFIRMED]: 'badge-success',
  [STATUS.REQUEST.REJECTED]: 'badge-danger',
  [STATUS.REQUEST.CANCELLED]: 'badge-danger',
  [STATUS.REQUEST.COMPLETED]: 'badge-neutral',
})

// 'Submitted' -> 'badge badge-info'
export function statusBadgeClass(status) {
  return `badge ${BADGE[status] ?? 'badge-neutral'}`
}
