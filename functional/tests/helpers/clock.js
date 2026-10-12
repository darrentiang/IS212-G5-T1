// One place for the app-clock override file shared by playwright.config.js
// (which passes it to the backend as CONNECTSPHERE_CLOCK_FILE) and
// SCRUM-49.spec.js (which pins and clears it). The file's ABSENCE means
// "no override": that is how real time is restored. The file's content must
// be a naive ISO minute (2026-12-15T11:00) — clock.now_local() raises rather
// than fall back if it cannot parse what it finds (SCRUM-49 plan §5).

import { renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const CLOCK_FILE = path.resolve(here, '..', '..', 'test-results', 'app-clock-override.txt')

// Atomic: write a temp file, then rename it into place, so a reader can
// never observe a partially written timestamp.
export function pinClock(isoMinute) {
  const tmp = `${CLOCK_FILE}.tmp`
  writeFileSync(tmp, isoMinute, 'utf8')
  renameSync(tmp, CLOCK_FILE) // replaces an existing destination on POSIX and Windows
}

export function clearClock() {
  rmSync(CLOCK_FILE, { force: true })
  rmSync(`${CLOCK_FILE}.tmp`, { force: true })
}
