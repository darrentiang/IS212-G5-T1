# Functional test-case drafting prompt

Use this to draft functional test cases for ONE story, before any code for that story is written. The output is rows for the "Test cases" tab of the team's test sheet. A developer curates the rows, a second developer reviews them, then the Playwright tests are written against them.

## Inputs (stop and ask if any is missing)
1. The story from Jira: key (SCRUM-nn), title, user story sentence, numbered acceptance criteria. Use the Jira text verbatim; never paraphrase or invent criteria.
2. `docs/design/state-model.md` — the only status names you may use.
3. `docs/design/permissions.md` — which roles may do what.

Do not invent statuses, roles, fields, limits, messages or timings that are not in these inputs. Where you must guess, say so (see Assumptions).

## Seeded accounts (use these names in preconditions and test data)
`org1`, `org2` (Event Organisers, different client organisations) · `coord1`, `coord2` (Event Coordinators) · `venue1` (Venue Staff) · `tech1` (Technical Support Staff) · `att1` (Attendee) · `multi1` (Event Coordinator and Venue Staff, the one two-role account). Password for all: `Passw0rd!`.

## Method (label each row with the step that produced it)
1. Visualise the workflow: who does this, from which screen, in which status.
2. **Happy** — one row for the main success scenario. One per role if the story has several actors.
3. **Cross** — only role- or state-specific behaviour this story adds (e.g. "org2 cannot open org1's request"). No generic login or authorisation rows; the Definition of Done covers those.
4. **Negative** — one row per rule in the criteria that can be violated: wrong status, missing required field, wrong role, wrong object. Say exactly what the user sees and that nothing changed.
5. **Boundary** — for every limit or window in the criteria, three rows: just below, exactly at, just above. If the criteria name a limit without a value, one row marked CHECK.

## Output — tab-separated rows, one per line, exactly these 12 columns, no header, nothing else before them
```
Story	TC ID	AC #	Step	Scenario	Preconditions	Steps	Test data	Expected result	Drafted with AI by	Curated by	Reviewed by
```
- Story: the Jira key, e.g. `SCRUM-26`.
- TC ID: `TC-SCRUM-<n>-<nn>`, e.g. `TC-SCRUM-26-01`, numbered in output order. If rows for this story already exist in the sheet, continue the numbering.
- AC #: the criterion number(s) the row is evidence for, e.g. `3` or `1, 2`. Every criterion appears at least once.
- Step: `2 Happy`, `3 Cross`, `4 Negative` or `5 Boundary`.
- Scenario: one sentence. Prefix `CHECK` if you are not confident it is a real requirement.
- Preconditions: concrete state — named accounts, objects and their statuses.
- Steps: numbered, from the user's point of view, no implementation detail, in one cell: `1. … 2. … 3. …`.
- Test data: the specific values entered, or `none`.
- Expected result: what is shown, what status results, what is or is not recorded. Never "works correctly".
- Drafted with AI by: `<name>, dd-mm-yyyy`.
- Curated by, Reviewed by: leave as `—`.

Cells must not contain tab or newline characters; separate numbered steps with spaces.

## After the rows, add two short sections
**Assumptions** — every guess (a field name, a message wording, whether a limit is inclusive), one line each, for the curator to confirm.
**Not covered** — behaviour the criteria imply but do not specify (e.g. second submit, concurrent edits), one line each. The curator decides whether it becomes a criterion, a new story, or is out of scope.

## Rules
- A criterion that only declares something out of scope gets no row; list it under Not covered as "declared out of scope".
- A criterion that describes a document or process obligation is not testable here; report it under Assumptions as "belongs in the Definition of Done".
- One scenario per row; no row that restates another with different names.
- No performance, load or usability rows; no numbers the customer never gave.
- Fewer, sharper rows: a story typically needs 5–12.

## Curation (developer, before the rows go into the sheet)
Check every row against the Jira acceptance criteria, resolve every Assumption, delete or reword CHECK rows, decide each Not covered item, fill "Curated by". Paste the rows into the Test cases tab. A second developer reads them and fills "Reviewed by". Only then are the Playwright tests written (see `AUTOMATION.md`).
