# Functional test-case drafting prompt

Use this to draft functional test cases for ONE story, before any code for that story is written. The output is rows for the "Test cases" tab of the team's test sheet. A developer curates the rows, a second developer reviews them, then the Playwright tests are written against them.

| Version | Date | Change | Reason |
|---|---|---|---|
| 1.0 | 15-09-2026 | Initial prompt | Test cases drafted with AI, curated by the team |
| 1.1 | 16-09-2026 | `ui-guidelines.md` and neighbouring stories as inputs; story-boundary rule; one Happy row per path, not per role; expected result capped at three clauses | First real run (SCRUM-26) drafted six near-identical Happy rows asserting another story's behaviour, with paragraph-long expected results |
| 1.2 | 22-09-2026 | Seeded venues and the facility and accessibility lists added to the seeded-data sections | SCRUM-31 seeds venues; rows for a venue story must name the seeded records and the fixed list values rather than invent them |
| 1.3 | 05-10-2026 | Stories come from the workbook Backlog, not Jira; `backend/seed/data.json` is the authority for seeded data; curation moved to `CURATION.md` | The backlog moved from Jira to the team scrum workbook (S1 Retro action S1-A3); curation was the weakest step and needed its own checklist |
| 1.4 | 19-10-2026 | Seeded accounts: `lead1` and `leadcoord1`, the Event Coordinator Lead role | SCRUM-86 adds the Lead role and its two seeded accounts; rows for the queue and assignment must name them |

## Inputs (stop and ask if any is missing)
1. The story from the Backlog tab of the team scrum workbook (SharePoint): key (SCRUM-nn), title, user story sentence, numbered acceptance criteria, and its Links and notes. Use the text verbatim; never paraphrase or invent criteria.
2. `docs/design/state-model.md` — the only status names you may use.
3. `docs/design/permissions.md` — which roles may do what.
4. `docs/design/ui-guidelines.md` — what every page shows and what it is called. Use its page names ("the Requests page", "the login page") and its words for what the user sees (banner, message under the field, header). Do not invent screens or elements it does not describe.
5. Optional: the keys and titles of the other stories in the sprint, so behaviour they own is not drafted here (see Rules).

Do not invent statuses, roles, fields, limits, messages or timings that are not in these inputs. Where you must guess, say so (see Assumptions).

## Seeded accounts (use these names in preconditions and test data)
The lists in this and the next two sections were current when written. `backend/seed/data.json` is the authority: if it holds accounts or records not listed here, use them by their seeded names.

`org1`, `org2` (Event Organisers, different client organisations) · `coord1`, `coord2` (Event Coordinators) · `venue1` (Venue Staff) · `tech1` (Technical Support Staff) · `att1` (Attendee) · `multi1` (Event Coordinator and Venue Staff) · `lead1` (Event Coordinator Lead) · `leadcoord1` (Event Coordinator Lead and Event Coordinator; with `multi1`, one of the two two-role accounts). Password for all: `Passw0rd!`.

## Seeded event requests (SCRUM-27 access data; loaded from `backend/seed/data.json`)
- **Annual Dinner** — created by `org1`, status **Submitted**
- **Design Workshop** — created by `org1`, status **Draft**
- **Client B Conference** — created by `org2`, status **Submitted**
- **Open House** — created by `org1`, status **Confirmed**, registration enabled

Create/edit/submit of requests is SCRUM-28 and later; these rows exist so access-control stories can be tested.

## Seeded venues and the two fixed lists (SCRUM-31 data; loaded from `backend/seed/data.json`)
- **Seminar Room 1** — Block A Level 2, maximum capacity 60, 08:00–20:00; facilities Projector, Whiteboard, Wi-Fi; accessibility features Step-free access, Lift access
- **Auditorium** — Block C Level 1, maximum capacity 400, 09:00–22:00; facilities Projector, Stage lighting, Sound system; accessibility features Step-free access, Hearing loop, Accessible toilet, Reserved seating

A venue's facilities and accessibility features are chosen from these fixed lists, not typed (team decision, 22-09-2026):
- **Facilities:** Projector, Stage lighting, Sound system, Whiteboard, Catering kitchen, Wi-Fi
- **Accessibility features:** Step-free access, Hearing loop, Accessible toilet, Lift access, Reserved seating

Editing a venue is SCRUM-75, retiring one SCRUM-76 and room layouts SCRUM-32; these two venues exist so a story that reads venues has standing data.

## Method (label each row with the step that produced it)
1. Visualise the workflow: who does this, from which screen, in which status.
2. **Happy** — one row per distinct path through the story, not per role. Two roles that follow the same steps to the same result are one row; a second row only where the story's own rules make the steps or the result differ (e.g. an account with two roles, when the story says roles are shown).
3. **Cross** — only role- or state-specific behaviour this story adds (e.g. "org2 cannot open org1's request"). No generic login or authorisation rows; the Definition of Done covers those.
4. **Negative** — one row per rule in the criteria that can be violated: wrong status, missing required field, wrong role, wrong object. Say exactly what the user sees and that nothing changed.
5. **Boundary** — for every limit or window in the criteria, three rows: just below, exactly at, just above. If the criteria name a limit without a value, one row marked CHECK.

## Output — tab-separated rows, one per line, exactly these 12 columns, no header, nothing else before them
```
Story	TC ID	AC #	Step	Scenario	Preconditions	Steps	Test data	Expected result	Drafted with AI by	Curated by	Reviewed by
```
- Story: the story key, e.g. `SCRUM-26`.
- TC ID: `TC-SCRUM-<n>-<nn>`, e.g. `TC-SCRUM-26-01`, numbered in output order. If rows for this story already exist in the sheet, continue the numbering.
- AC #: the criterion number(s) the row is evidence for, e.g. `3` or `1, 2`. Every criterion appears at least once.
- Step: `2 Happy`, `3 Cross`, `4 Negative` or `5 Boundary`.
- Scenario: one sentence. Prefix `CHECK` if you are not confident it is a real requirement.
- Preconditions: concrete state — named accounts, objects and their statuses.
- Steps: numbered, from the user's point of view, no implementation detail, in one cell: `1. … 2. … 3. …`.
- Test data: the specific values entered, or `none`.
- Expected result: at most three clauses — what is shown, what status or state results, what did not happen. Never "works correctly". If it needs more, it is two rows, or it belongs in the story.
- Drafted with AI by: `<name>, dd-mm-yyyy`.
- Curated by, Reviewed by: leave as `—`.

Cells must not contain tab or newline characters; separate numbered steps with spaces.

## After the rows, add two short sections
**Assumptions** — every guess (a field name, a message wording, whether a limit is inclusive), one line each, for the curator to confirm.
**Not covered** — behaviour the criteria imply but do not specify (e.g. second submit, concurrent edits), one line each. The curator decides whether it becomes a criterion, a new story, or is out of scope.

## Rules
- **A row proves only what this story builds.** Behaviour another story owns goes under Not covered with that story's key, even when a criterion here mentions it (a login story does not prove which functions each role sees; that is the role-based access story). If a criterion cannot be proved without the other story, say so under Assumptions so the Product Owner can amend it.
- A criterion that only declares something out of scope gets no row; list it under Not covered as "declared out of scope".
- A criterion that describes a document or process obligation is not testable here; report it under Assumptions as "belongs in the Definition of Done".
- One scenario per row; no row that restates another with different names.
- No performance, load or usability rows; no numbers the customer never gave.
- Fewer, sharper rows: a story typically needs 5–12.

## Curation (developer, before the rows go into the sheet)
Follow `CURATION.md`: check every row against the Backlog acceptance criteria, resolve every Assumption, delete or reword CHECK rows, decide each Not covered item, fill "Curated by". Paste the rows into the Test cases tab. A second developer reads them and fills "Reviewed by". Only then are the Playwright tests written (see `AUTOMATION.md`).
