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
