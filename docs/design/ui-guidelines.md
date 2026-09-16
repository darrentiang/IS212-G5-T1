# UI guidelines

What every page shows, how it behaves for the user and the `data-testid` of every element. Test-case rows describe what the user sees on these pages; Playwright tests find elements by the ids defined here, so an id must be predictable from this file alone. How the front end is built lives in `frontend.md`; who may do what in `permissions.md`; status names in `state-model.md`; `/api/me` and refusals in `docs/adr/ADR-002-authorisation.md`. Changing a rule or a test id pattern means changing this file first, in the same pull request.

| Version | Date | Change | Reason |
|---|---|---|---|
| 1.0 | 16-09-2026 | Initial guidelines | Functional tests for SCRUM-26/27 need stable test ids before the scaffold is built |

## 1. Pages

| Route | Page name (test id prefix) | Who reaches it |
|---|---|---|
| `/login` | `login` | Anyone not logged in |
| `/requests` | `requests` | Logged in; the API returns only what the account may see |
| `/requests/new` | `request-new` | Feature per `permissions.md` |
| `/requests/:id` | `request-detail` | Feature and object rule per `permissions.md` |
| `/venues` (later) | `venues` | Feature per `permissions.md` |
| — (shown in place of a refused page) | `not-permitted` | Anyone whose account lacks the page's feature |

- Not logged in → any page sends the user to `/login`. After logging in → `/requests`.
- `/` and unknown addresses go to `/requests`.
- An account without a page's feature sees the not-permitted page at the same address; it is not redirected.

## 2. Layout

Every page except `/login` sits inside the same layout.

- **Header:** username, every role the account holds (comma-separated, in the order `/api/me` returns them), a Log out button.
- **Nav:** one link per page the account may open. A link that would lead to the not-permitted page is not shown.
- **Main:** the page, starting with its banner (§3).

| Element | `data-testid` |
|---|---|
| Username | `layout-username` |
| Roles | `layout-roles` |
| Log out button | `layout-logout-button` |
| Nav link | `layout-nav-<page>` (e.g. `layout-nav-requests`) |

## 3. Banners

- One banner at a time, at the top of the page content.
- Error: `role="alert"`. Success: `role="status"`. The text states what happened ("Request submitted", or the API's refusal message word for word). The page never replaces a refusal with its own wording.
- A refusal (the API says no) always shows in the banner, even when the page hid the control that led to it.
- A banner stays until the user's next action or navigation. No auto-dismiss, so tests never race a timer.
- After an action that moves the user to another page (e.g. submitting a new request opens its detail page), the success banner shows on the page they land on.
- A session that has ended sends the user to `/login`.
- Test id: `<page>-banner`. Tests tell success from error by `role`.

## 4. Forms

- Label above its field.
- Required fields: label ends with ` *`, the input has `aria-required="true"`. No native `required` attribute (browser pop-ups bypass our messages and cannot be asserted consistently).
- On submit the page checks required fields are filled and shows a message under each empty one, sending nothing. Every other rule is the API's: a refusal about one field shows under that field, any other refusal in the banner.
- Input types: `date`, `time`, `number` where the value is one; a select for fixed choices; a textarea for long text.
- Buttons at the bottom right. One primary button (the action that completes the story), secondary buttons to its left (e.g. Save draft left of Submit).
- All buttons disabled while the request is being sent.

| Element | `data-testid` | Example |
|---|---|---|
| Input / select / textarea | `<page>-<field>-input` | `request-new-attendance-input` |
| Message under a field | `<page>-<field>-error` | `request-new-attendance-error` |
| Button | `<page>-<action>-button` | `request-new-submit-button` |

`<field>` is the API field name in kebab-case.

## 5. Lists

- A plain table with a header row, one row per record.
- The first cell links to the record's detail page.
- Status shown as the exact status text from `state-model.md` (e.g. Submitted, Planning). Colour may accompany the text, never replace it.
- A flag is not a status: "Clarification requested" shows as its own text beside the status, never appended to it.
- No records → one sentence saying so instead of the table.
- On narrow screens the table scrolls sideways; no column is hidden.

| Element | `data-testid` | Example |
|---|---|---|
| Row | `<page>-row-<id>` | `requests-row-12` |
| Status cell | `<page>-status-<id>` | `requests-status-12` |
| Flag beside a status | `<page>-<flag>-flag-<id>` | `requests-clarification-flag-12` |
| Empty message | `<page>-empty` | `requests-empty` |

## 6. Detail pages

- Fields as label/value pairs, in the order the form uses.
- Status as text; a flag as its own text beside it.
- Actions (approve, reject, …) are buttons per §4, shown only when the account's features allow them.

| Element | `data-testid` | Example |
|---|---|---|
| Field value | `<page>-<field>` | `request-detail-attendance` |
| Status | `<page>-status` | `request-detail-status` |
| Flag | `<page>-<flag>-flag` | `request-detail-clarification-flag` |

## 7. Not-permitted page

- One sentence saying the account cannot open this page, and a link to `/requests`.
- Test ids: `not-permitted-message`, `not-permitted-home-link`.

## 8. Test ids, summary

- Every input, button, link that acts, banner, row, status, flag and empty message has a `data-testid`.
- Format `<page>-<element>`, kebab-case, `<page>` from §1 (`layout` for the layout).
- Tests find elements by test id only; text is asserted, never used to find an element.
- Renaming a test id changes every test that uses it: update those tests in the same pull request.

## 9. Review checks (per pull request that touches a page)

1. Every element in §8 has a test id matching the patterns here.
2. Refusals show the API's message; nothing fails silently.
3. Controls the account cannot use are hidden, and the page still shows a refusal if the API says no.
4. Status and flag text match `state-model.md` exactly; colour never stands alone.
