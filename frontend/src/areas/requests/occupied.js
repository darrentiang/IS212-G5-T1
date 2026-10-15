import { formatDateTimePeriod, formatPeriod } from '../../app/format'

// The occupied period a venue booking or hold covers, as the Venues section
// shows it (ui-guidelines.md §7): on one day it reads like a booking's
// ('05 Dec 2026, 09:30–12:30'); one crossing midnight shows both ends in full.
export function occupiedText(row) {
  const [startDate, startTime] = row.occupied_start.split('T')
  const [endDate, endTime] = row.occupied_end.split('T')
  return startDate === endDate
    ? formatPeriod(startDate, startTime, endTime)
    : formatDateTimePeriod(row.occupied_start, row.occupied_end)
}
