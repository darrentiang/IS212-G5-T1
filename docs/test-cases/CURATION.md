# Curating drafted test cases

Use this after `PROMPT.md` has drafted the rows for ONE story, before the rows go into the Test cases tab. The curator is a Developer; a second Developer reviews. The curated rows are the specification the Playwright tests prove (`AUTOMATION.md`), so a wrong row becomes a wrong test that passes.

| Version | Date | Change | Reason |
|---|---|---|---|
| 1.0 | 05-10-2026 | Initial checklist | Curation was one paragraph in `PROMPT.md` and the step most often redone; the Week 4 method gives it a fixed order |

## Why curation is needed

An AI draft is strongest on the happy path and on cross-cutting checks, and weakest on boundaries and business-rule negatives, because those depend on context the story text leaves implicit. When AI writes both the code and the tests, both share the same blind spot. The curator owns three things the draft cannot: which behaviour is required, which risks matter, and whether each expected result is right.

## Inputs (open all before starting)
1. The drafted rows, with their Assumptions and Not covered sections.
2. The story's row in the Backlog tab of the team scrum workbook: Acceptance criteria, Links and notes, Change history.
3. `docs/design/state-model.md`, `docs/design/permissions.md`, `docs/design/ui-guidelines.md`.
4. `backend/seed/data.json`: the accounts and records the rows may name.

## Pass 1: every criterion is covered, by this story only
- [ ] Every AC number appears in the AC # column of at least one row.
- [ ] Each row's AC # is the criterion the row actually proves.
- [ ] A checklist criterion that names several rules has a row per rule (one AC can become several rows).
- [ ] No row proves behaviour another story owns. Move it to Not covered with that story's key.
- [ ] A criterion that only declares something out of scope has no row.

## Pass 2: each row is a real test case
Map each row to Given / When / Then:
- [ ] **Preconditions = Given.** Named seeded accounts and records, with their statuses, that exist in `data.json`. Never "a user" or "a request".
- [ ] **Steps and Test data = When.** Numbered user actions from the screen, no implementation detail; concrete values typed, or `none`.
- [ ] **Expected result = Then.** At most three clauses: what is shown, what status results, what did not happen. Specific output for a specific input, never "works correctly".
- [ ] Where a row says "nothing changed", it is checkable: what to reload and what must still be there.

## Pass 3: negatives (where drafts are weakest)
For each rule in the criteria, list how it can be violated and check there is a row for each that the story defines:
- [ ] **Bad user data:** missing, blank or whitespace-only, wrong type, wrong format, out of range.
- [ ] **Business exceptions:** wrong status for the action; wrong role; another user's or another organisation's record; already decided or already done; conflict with an existing record.
- [ ] **System unavailability:** covered once by the Definition of Done (an error message, nothing lost). Add a row only when the story specifies its own behaviour.
- [ ] Every refusal row states the message the user sees and that nothing changed.

## Pass 4: boundaries and partitions
- [ ] List every limit, window and ordering in the criteria, including derived values: a date against today, start against end, attendance against capacity, a booking's occupied period once setup and turnaround time are added, an expiry time, periods that touch against periods that overlap.
- [ ] Each limit has three rows: just below, exactly at, just above.
- [ ] Inclusive or exclusive is stated by the criterion. If it is not, that is a question for the Product Owner (see "When curation finds an AC problem"), not a guess.
- [ ] **Equivalence partitioning:** one row per group of inputs that behaves the same (each status that allows the action against each that refuses it; each role allowed against refused). Do not multiply rows inside a group.

## Pass 5: consistent with the design documents
- [ ] Status words are exactly those in `state-model.md`; no invented status.
- [ ] Who may do what matches `permissions.md`, including multi-role accounts.
- [ ] Page and element names come from `ui-guidelines.md`.
- [ ] Every named account and record exists in `data.json`, or the row's preconditions create it first.

## Pass 6: cut
- [ ] Delete duplicates and rows that restate another with different names.
- [ ] Delete generic login or authorisation rows (the Definition of Done covers them) and performance or usability rows.
- [ ] A story typically ends with 5–12 rows. More usually means duplicates; fewer usually means missing negatives or boundaries.

## Resolve the draft's notes
- [ ] Every Assumption is confirmed, corrected, or turned into a question for the Product Owner.
- [ ] Every CHECK row is deleted or reworded.
- [ ] Every Not covered item is decided: an AC change (Product Owner), a new story (Product Owner), or out of scope.

## When curation finds an AC problem
Stop. Do not write rows to a guessed criterion. Raise it with the Product Owner. If the criterion is refined, the Product Owner updates the Backlog (Acceptance criteria and Change history) and logs it in the current sprint's Retro the same day; then re-draft or correct the affected rows.

## Finish
Fill "Curated by", paste the rows into the Test cases tab. The reviewer repeats Passes 1 and 4 independently, then fills "Reviewed by". Only then are the Playwright tests written.

## Patterns corrected before
Add one line each time curation catches something a draft keeps getting wrong.
- Near-identical happy rows, one per role, where the roles follow the same steps (SCRUM-26).
- Rows asserting another story's behaviour (SCRUM-26).
- Paragraph-long expected results (SCRUM-26).
- Preconditions that assume an empty shared functional database; tests check the records they created (SCRUM-40).
