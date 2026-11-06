# C4 Diagrams: change history

The model is `workspace.dsl` in this folder. Paste it into the Structurizr DSL editor to render the two views, `C1_SystemContext` and `C2_Containers`.

| Date | Version | What changed | Why | Decided at | Evidence |
|---|---|---|---|---|---|
| 2026-09-10 | v1 | Initial agreement: five roles, one software system, three containers (web app, API, database), no external systems. | Team setup before Sprint 1 (ADR-001 to ADR-003). | Pre-planning session | PR #6 (`d86bf8c`) |
| 2026-10-21 | v2 | Added the Event Coordinator Lead and Safety Officer roles. Containers unchanged (web app, API, database). Notifications stay in-app, with no worker or gateway. | Week 7 customer changes: Coordinator Lead, Safety Officer, plus venue setup/turnaround, venue unavailability, multiple venues per event and expiring holds, which need no new containers. | Sprint 3 Retrospective | Roles added with their stories: Safety Officer in PR #49 (SCRUM-89), Lead in PR #66 (SCRUM-86); recorded in PR #78 |
| 2026-11-06 | v3 | Descriptions brought up to date with Sprint 4: what each role does, the system now runs from request to completion, the database includes holds and change requests, and the database technology matches ADR-001 (no hosted demo). Shorter text and larger shapes, so every name fits inside its shape. No new elements; the views stay C1 and C2. | Sprint 4 stories (SCRUM-45, 46, 47, 52, 54 to 57, 59 to 61, 64 to 66, 92) changed what Organisers, Coordinators and Attendees do. In the v2 render, long descriptions pushed names out of their shapes. | End of Sprint 4, by the C4 owner (Kieren); reviewed in the pull request | PR #98 |
