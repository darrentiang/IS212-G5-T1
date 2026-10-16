import { describe, it, expect } from 'vitest'
import {
  STATUS,
  formatDate,
  formatDateTime,
  formatDateTimePeriod,
  formatPeriod,
  formatTime,
  statusBadgeClass,
} from '../format'

describe('formatDate', () => {
  // @story: setup
  // @ac: ui-shell
  it('writes an ISO date as day, short month, year', () => {
    expect(formatDate('2026-10-03')).toBe('03 Oct 2026')
    expect(formatDate('2026-01-09')).toBe('09 Jan 2026')
  })

  // @story: setup
  // @ac: ui-shell
  it('throws on anything that is not an ISO date', () => {
    expect(() => formatDate('3/10/2026')).toThrow(/ISO date/)
  })

  // @story: setup
  // @ac: ui-shell
  it('throws on a date that does not exist rather than rolling it forward', () => {
    expect(() => formatDate('2026-02-31')).toThrow(/real date/)
  })

  // @story: SCRUM-41
  // @ac: 1
  it('accepts a four-digit year below 0100, as a clamped period sends', () => {
    expect(formatDate('0001-01-01')).toBe('01 Jan 0001')
    expect(formatDate('0099-12-31')).toBe('31 Dec 0099')
  })

  // @story: SCRUM-41
  // @ac: 1
  it('still rejects a date that does not exist below 0100', () => {
    expect(() => formatDate('0001-02-31')).toThrow(/real date/)
  })
})

describe('formatTime', () => {
  // @story: setup
  // @ac: ui-shell
  it('passes a 24-hour time through', () => {
    expect(formatTime('14:30')).toBe('14:30')
  })

  // @story: setup
  // @ac: ui-shell
  it('throws on anything that is not a 24-hour time', () => {
    expect(() => formatTime('2pm')).toThrow(/24-hour time/)
  })
})

describe('formatPeriod', () => {
  // @story: setup
  // @ac: ui-shell
  it('joins the date and the two times with an en dash', () => {
    expect(formatPeriod('2026-10-03', '14:30', '16:00')).toBe('03 Oct 2026, 14:30–16:00')
  })
})

describe('formatDateTime', () => {
  // @story: SCRUM-29
  // @ac: 2, 7
  it('shows an ISO date and time as the date, a comma and the 24-hour time', () => {
    expect(formatDateTime('2026-09-23T14:05:00')).toBe('23 Sep 2026, 14:05')
    expect(formatDateTime('2026-09-01T09:30:12.123456+00:00')).toBe('01 Sep 2026, 09:30')
  })

  // @story: SCRUM-29
  // @ac: 2, 7
  it('throws on a value that is not an ISO date and time', () => {
    expect(() => formatDateTime('2026-09-23')).toThrow(/Not an ISO date and time/)
    expect(() => formatDateTime(null)).toThrow(/Not an ISO date and time/)
  })
})

describe('formatDateTimePeriod', () => {
  // @story: SCRUM-40
  // @ac: 2
  it('shows a period across two dates as two date-times joined by "to"', () => {
    expect(formatDateTimePeriod('2026-10-20T09:00', '2026-10-21T18:00')).toBe(
      '20 Oct 2026, 09:00 to 21 Oct 2026, 18:00',
    )
  })

  // @story: SCRUM-40
  // @ac: 2
  it('repeats the date when both ends fall on the same day', () => {
    expect(formatDateTimePeriod('2026-10-20T10:00', '2026-10-20T10:01')).toBe(
      '20 Oct 2026, 10:00 to 20 Oct 2026, 10:01',
    )
  })

  // @story: SCRUM-40
  // @ac: 2
  it('throws when either end is not an ISO date and time', () => {
    expect(() => formatDateTimePeriod('2026-10-20T09:00', '2026-10-21')).toThrow(/Not an ISO date and time/)
    expect(() => formatDateTimePeriod('2026-10-20', '2026-10-21T18:00')).toThrow(/Not an ISO date and time/)
  })

  // @story: SCRUM-41
  // @ac: 1, 5
  it('shows a clamped occupied period end to end, exactly as the API sends it', () => {
    expect(formatDateTimePeriod('0001-01-01T00:00', '2026-12-15T12:15')).toBe(
      '01 Jan 0001, 00:00 to 15 Dec 2026, 12:15',
    )
  })
})

describe('STATUS', () => {
  // @story: setup
  // @ac: ui-shell
  it('holds the event request statuses from the state model, and every group is frozen', () => {
    expect(Object.values(STATUS.REQUEST)).toEqual([
      'Draft',
      'Submitted',
      'Approved',
      'Rejected',
      'Planning',
      'Safety Check',
      'Confirmed',
      'Completed',
      'Cancelled',
    ])
    expect(STATUS.REQUEST.SUBMITTED).toBe('Submitted')
    expect(STATUS.UNIT.OUT_OF_SERVICE).toBe('Out of Service')

    expect(Object.isFrozen(STATUS)).toBe(true)
    for (const group of Object.values(STATUS)) {
      expect(Object.isFrozen(group)).toBe(true)
    }
  })
})

describe('statusBadgeClass', () => {
  // @story: setup
  // @ac: ui-look
  it('gives every event request status its colour from the Look table', () => {
    const R = STATUS.REQUEST
    expect(statusBadgeClass(R.DRAFT)).toBe('badge badge-neutral')
    expect(statusBadgeClass(R.SUBMITTED)).toBe('badge badge-info')
    expect(statusBadgeClass(R.APPROVED)).toBe('badge badge-success')
    expect(statusBadgeClass(R.PLANNING)).toBe('badge badge-warning')
    expect(statusBadgeClass(R.CONFIRMED)).toBe('badge badge-success')
    expect(statusBadgeClass(R.REJECTED)).toBe('badge badge-danger')
    expect(statusBadgeClass(R.CANCELLED)).toBe('badge badge-danger')
    expect(statusBadgeClass(R.COMPLETED)).toBe('badge badge-neutral')
  })

  // @story: setup
  // @ac: ui-look
  it('falls back to neutral for a status without a colour of its own', () => {
    expect(statusBadgeClass(STATUS.RESERVATION.RESERVED)).toBe('badge badge-neutral')
  })

  // @story: SCRUM-83
  // @ac: 3
  it('holds a cancelled booking and shows it as Danger, like a cancelled request', () => {
    expect(Object.values(STATUS.BOOKING)).toEqual(['Requested', 'Approved', 'Rejected', 'Withdrawn', 'Cancelled'])
    expect(statusBadgeClass(STATUS.BOOKING.CANCELLED)).toBe('badge badge-danger')
  })

  // @story: SCRUM-48
  // @ac: 3
  it('shows a Declined requirement as Danger, like a rejected request', () => {
    expect(Object.values(STATUS.REQUIREMENT)).toEqual(['Requested', 'Approved', 'Declined'])
    expect(statusBadgeClass(STATUS.REQUIREMENT.DECLINED)).toBe('badge badge-danger')
  })
})
