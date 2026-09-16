# Coverage policy

What coverage the team aims for, what is excluded and why, and what a reviewer checks. Read with `AUTOMATION.md`: that file says which tests prove what, this one says how much of the code they must reach.

| Version | Date | Change | Reason |
|---|---|---|---|
| 1.1 | 16-09-2026 | `routes.jsx` excluded | The UI shell tests mock the combined route list, which left the per-area lists unexecuted |
| 1.0 | 16-09-2026 | Initial policy | The rubric asks for 100 % coverage or a stated reason; the measured numbers include entry points nothing can unit-test, so the exclusions and the target needed writing down |

## Target

**100 % of the files a story touches.** Not 100 % of the repository: a file no story has reached yet is not this story's debt. Coverage is measured on every run of all three suites and printed in the terminal and on the pull request summary page.

A story that cannot reach 100 % of its own files says so in the pull request description, naming the lines and the reason. That is a decision the reviewer reads and accepts or rejects; it is not a silent gap.

## Exclusions

These files are excluded from the measurement everywhere, because no unit test can reach them and something else proves them. They are listed here so that the list has one home; `backend/.coveragerc` and `frontend/vitest.config.js` carry the same entries.

| Excluded | Where | Why, and what proves it instead |
|---|---|---|
| `backend/tests/*` | `.coveragerc` | The tests themselves. |
| `backend/seed.py` | `.coveragerc` | `seed_database` is exercised by the pytest `app` fixture on every test, but the file is dominated by its command line interface (`--reset`, "already seeded", the version-mismatch exit). The CLI is proven by the walk-through in the setup spec's Done-when list and by the Playwright `webServer` command, which reseeds the database before every functional run. |
| `if __name__ == "__main__":` blocks | `.coveragerc` | Process entry points. Proven by actually starting the app. |
| Lines marked `pragma: no cover` | `.coveragerc` | Deliberate, and rare: a reviewer should question every one. |
| `frontend/src/**/__tests__/**` | `vitest.config.js` | The tests themselves. |
| `frontend/src/main.jsx` | `vitest.config.js` | The browser entry point: it renders `<App />` and nothing else. |
| `frontend/src/areas/*/api.js` | `vitest.config.js` | One-line calls to `request()` under their contract comment (`docs/design/frontend.md` §6). Unit tests mock these modules, so a unit test can never execute them; Playwright drives the real ones through the browser. |
| `frontend/src/app/areas.js` | `vitest.config.js` | An import list. A missing area shows up as a missing page in the functional tests. |
| `frontend/src/areas/*/routes.jsx` | `vitest.config.js` | A list literal of pages and paths. `App` and `Layout` tests mock the combined list, so nothing executes the real ones; a wrong entry shows up as a missing page in the functional tests. |

Adding an exclusion means adding a row here, with its reason, in the same pull request as the config change.

## What the reviewer checks

1. The coverage summary on the pull request, for the files this story touched — not the repository total.
2. Any shortfall is stated in the description with a reason, and the reason is about the code, not about time.
3. A new exclusion has a row in the table above.

## No CI threshold yet

Nothing fails the build on a coverage number today. The suites fail on failing tests only. Whether to add a threshold, and what it should be, is a decision for the Sprint 1 retrospective, once there are enough stories to know what the number looks like in practice.
