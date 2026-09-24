import { describe, it, expect } from 'vitest'
import { STATUS, formatDate, formatDateTime, formatPeriod, formatTime } from '../format'

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
