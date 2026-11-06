workspace "ConnectSphere" "Event Planning and Venue Booking System — release 1 (ADR-001, ADR-002, ADR-003). C4 model v3; history in docs/c4/change-history.md." {

    !identifiers hierarchical

    model {
        // --- People ---
        organiser = person "Event Organiser" "External client representative who creates and submits their own event requests, answers clarification requests, sees the arrangements once Confirmed, views registrations, and asks for changes or withdrawal after submission." "External"
        attendee = person "Attendee" "External participant who registers for Confirmed events open for registration, sees their registrations and can withdraw." "External"

        coordinator = person "Event Coordinator" "Internal liaison who manages only the events assigned to them: decides and clarifies requests, holds and books venues, records equipment needs, sends events for safety check, edits events, decides change requests, sets registration, and cancels or completes events." "Internal"
        coordinatorLead = person "Event Coordinator Lead" "Internal supervisor who assigns each newly submitted request in the unassigned queue to an Event Coordinator, reassigns events, and sees all assignments and active events." "Internal"
        venueStaff = person "Venue Staff" "Internal staff who maintain venues (details, layouts, setup and turnaround times, operating hours, blocks) and decide venue booking requests." "Internal"
        techStaff = person "Technical Support Staff" "Internal staff who maintain the equipment inventory, check availability, review equipment requirements and reserve or release equipment." "Internal"
        safetyOfficer = person "Safety Officer" "Internal staff who review the operational safety of an event in Safety Check and approve it, reject it or return it for changes." "Internal"

        // --- Deferred beyond release 1 (ADR-003): shown only in the Future_Deferred view ---
        gateway = softwareSystem "Email / SMS Gateway" "Deferred (ADR-003): external delivery of notifications by email or SMS. No release 1 requirement needs it." "External System,Future"

        // --- Software system in scope ---
        connectSphere = softwareSystem "ConnectSphere Platform" "Single system that takes an event from request to completion: request and review, coordinator assignment, venues, holds and bookings, equipment, safety check, registration, change requests and in-app notifications." {

            webApp = container "Web Application" "Single-page interface for every role. One folder per feature area mirrors the API; every call goes through one client module (app/http.js), and the page shows only what the API allows." "React 19 / React Router 7 / Vite / Tailwind CSS"

            apiApp = container "API Application" "Owns every business rule: role- and relationship-based access (ADR-002), event status transitions, venue and equipment conflict detection, holds and their expiry, safety checks, registration, change requests and in-app notifications (ADR-003). Checks hold expiry before every API request; there is no background worker." "Python / Flask / SQLAlchemy" {

                // Feature areas: one Flask blueprint each (backend/areas/<area>/)
                auth = component "Auth & Sessions" "Log in, log out and the current account with its roles and features (Flask session cookie)." "Flask blueprint: areas/auth"
                requests = component "Event Requests" "Drafts and submission, the unassigned queue, assignment and reassignment, decisions and clarification, edits after submission with a change record, safety check, cancellation and completion." "Flask blueprint: areas/requests"
                venues = component "Venues" "Venue catalogue, layouts, setup and turnaround times, operating hours, blocks, and venue search by date, capacity and features." "Flask blueprint: areas/venues"
                bookings = component "Bookings & Holds" "Venue booking requests and their decisions, withdrawal and cancellation, suitability warnings, clashes, and tentative holds with expiry." "Flask blueprint: areas/bookings"
                equipment = component "Equipment" "Inventory and service changes, event requirements and their review, availability for a period, and reservations." "Flask blueprint: areas/equipment"
                registration = component "Registration" "Registration settings for an event, register and withdraw, my registrations, and an event's registrations." "Flask blueprint: areas/registration"
                changes = component "Change Requests" "Organisers raise a change or withdrawal request; the assigned coordinator accepts or declines it." "Flask blueprint: areas/changes, change_requests.py"
                notificationsApi = component "Notifications" "Reads and marks a user's notifications; writes every notice in the same transaction as the change it reports (ADR-003)." "Flask blueprint: areas/notifications, notifications.py, event_notices.py"

                // Shared rules: plain Python modules, one rule in one place
                permissions = component "Permissions" "Role-to-feature matrix and the require() guard on every route: 401 when not logged in, 403 when the role lacks the feature (ADR-002). Object rules live in each area's services." "Python module: permissions.py"
                occupancy = component "Occupancy Rule" "The one overlap rule: a booking or hold occupies its period widened by the venue's setup and turnaround time; blocks are never widened; touching periods do not conflict; an expired hold holds nothing. Derived at read time, never stored." "Python module: occupancy.py"
                flags = component "Arrangement Flags" "Too small and Timing mismatch flags on bookings, holds and reservations, derived at every read so they clear by themselves." "Python module: arrangement_flags.py"
                clock = component "Clock" "The one source of the current time (Singapore local), so tests can pin it." "Python module: clock.py"
                domain = component "Domain Model" "SQLAlchemy models and session for every table, with the schema version check." "Python modules: models.py, db.py"
            }

            // Deferred beyond release 1 (ADR-003): shown only in the Future_Deferred view
            worker = container "Notification & Task Worker" "Deferred (ADR-003): would send reminders (backlog SCRUM-74) and scheduled notices without waiting for a request." "Not built" "Future"

            database = container "Database" "Accounts and roles; event requests with decisions, clarifications, safety decisions, change requests and their change record; venues, layouts, blocks, holds and booking requests; equipment types, service changes, requirements and reservations; registrations; notifications." "SQLite (development and CI); PostgreSQL possible by connection string only, no code change (ADR-001)" "Database"
        }

        // --- People to the Web Application (Structurizr derives C1 from these) ---
        organiser -> connectSphere.webApp "Submits requests, replies to clarifications, requests changes and views arrangements using" "HTTPS"
        attendee -> connectSphere.webApp "Registers for events and views or withdraws registrations using" "HTTPS"
        coordinator -> connectSphere.webApp "Reviews, plans and manages assigned events using" "HTTPS"
        coordinatorLead -> connectSphere.webApp "Assigns and reassigns events and views all assignments using" "HTTPS"
        venueStaff -> connectSphere.webApp "Maintains venues and blocks and decides bookings using" "HTTPS"
        techStaff -> connectSphere.webApp "Maintains, reviews and reserves equipment using" "HTTPS"
        safetyOfficer -> connectSphere.webApp "Reviews and decides safety checks using" "HTTPS"

        // --- Container level (C2). Declared first so Structurizr does not invent these from the component arrows ---
        connectSphere.webApp -> connectSphere.apiApp "Makes API calls to (session cookie)" "JSON / HTTPS"
        connectSphere.apiApp -> connectSphere.database "Reads from and writes to" "SQL"

        // --- Web Application to API feature areas (C3) ---
        connectSphere.webApp -> connectSphere.apiApp.auth "Logs in and reads the current account" "JSON / HTTPS, session cookie"
        connectSphere.webApp -> connectSphere.apiApp.requests "Calls" "JSON / HTTPS"
        connectSphere.webApp -> connectSphere.apiApp.venues "Calls" "JSON / HTTPS"
        connectSphere.webApp -> connectSphere.apiApp.bookings "Calls" "JSON / HTTPS"
        connectSphere.webApp -> connectSphere.apiApp.equipment "Calls" "JSON / HTTPS"
        connectSphere.webApp -> connectSphere.apiApp.registration "Calls" "JSON / HTTPS"
        connectSphere.webApp -> connectSphere.apiApp.changes "Calls" "JSON / HTTPS"
        connectSphere.webApp -> connectSphere.apiApp.notificationsApi "Calls" "JSON / HTTPS"

        // --- Inside the API (from the imports in backend/) ---
        connectSphere.apiApp.auth -> connectSphere.apiApp.permissions "Reads features from"
        connectSphere.apiApp.requests -> connectSphere.apiApp.permissions "Checks access with"
        connectSphere.apiApp.venues -> connectSphere.apiApp.permissions "Checks access with"
        connectSphere.apiApp.bookings -> connectSphere.apiApp.permissions "Checks access with"
        connectSphere.apiApp.equipment -> connectSphere.apiApp.permissions "Checks access with"
        connectSphere.apiApp.registration -> connectSphere.apiApp.permissions "Checks access with"
        connectSphere.apiApp.changes -> connectSphere.apiApp.permissions "Checks access with"
        connectSphere.apiApp.notificationsApi -> connectSphere.apiApp.permissions "Checks access with"

        connectSphere.apiApp.requests -> connectSphere.apiApp.occupancy "Checks for blocks over bookings with"
        connectSphere.apiApp.venues -> connectSphere.apiApp.occupancy "Searches and lists occupied periods with"
        connectSphere.apiApp.bookings -> connectSphere.apiApp.occupancy "Detects conflicts with"
        connectSphere.apiApp.occupancy -> connectSphere.apiApp.clock "Reads the time from"

        connectSphere.apiApp.requests -> connectSphere.apiApp.flags "Shows flags from"
        connectSphere.apiApp.bookings -> connectSphere.apiApp.flags "Shows flags from"
        connectSphere.apiApp.equipment -> connectSphere.apiApp.flags "Shows flags from"

        connectSphere.apiApp.requests -> connectSphere.apiApp.changes "Closes open change requests through"
        connectSphere.apiApp.changes -> connectSphere.apiApp.requests "Cancels events through"
        connectSphere.apiApp.bookings -> connectSphere.apiApp.requests "Starts planning through"
        connectSphere.apiApp.requests -> connectSphere.apiApp.registration "Keeps registration settings in step through"
        connectSphere.apiApp.registration -> connectSphere.apiApp.requests "Locks and reads events through"

        connectSphere.apiApp.requests -> connectSphere.apiApp.notificationsApi "Sends notices through"
        connectSphere.apiApp.venues -> connectSphere.apiApp.notificationsApi "Sends notices through"
        connectSphere.apiApp.bookings -> connectSphere.apiApp.notificationsApi "Sends notices through"
        connectSphere.apiApp.equipment -> connectSphere.apiApp.notificationsApi "Sends notices through"
        connectSphere.apiApp.registration -> connectSphere.apiApp.notificationsApi "Sends notices through"
        connectSphere.apiApp.changes -> connectSphere.apiApp.notificationsApi "Sends notices through"

        connectSphere.apiApp.requests -> connectSphere.apiApp.clock "Reads the time from"
        connectSphere.apiApp.venues -> connectSphere.apiApp.clock "Reads the time from"
        connectSphere.apiApp.bookings -> connectSphere.apiApp.clock "Reads the time from"
        connectSphere.apiApp.equipment -> connectSphere.apiApp.clock "Reads the time from"
        connectSphere.apiApp.registration -> connectSphere.apiApp.clock "Reads the time from"
        connectSphere.apiApp.changes -> connectSphere.apiApp.clock "Reads the time from"

        connectSphere.apiApp.auth -> connectSphere.apiApp.domain "Reads and writes through"
        connectSphere.apiApp.requests -> connectSphere.apiApp.domain "Reads and writes through"
        connectSphere.apiApp.venues -> connectSphere.apiApp.domain "Reads and writes through"
        connectSphere.apiApp.bookings -> connectSphere.apiApp.domain "Reads and writes through"
        connectSphere.apiApp.equipment -> connectSphere.apiApp.domain "Reads and writes through"
        connectSphere.apiApp.registration -> connectSphere.apiApp.domain "Reads and writes through"
        connectSphere.apiApp.changes -> connectSphere.apiApp.domain "Reads and writes through"
        connectSphere.apiApp.notificationsApi -> connectSphere.apiApp.domain "Reads and writes through"
        connectSphere.apiApp.domain -> connectSphere.database "Reads from and writes to" "SQL (SQLAlchemy)"

        // --- Deferred beyond release 1 (ADR-003) ---
        connectSphere.apiApp -> connectSphere.worker "Would queue reminders and scheduled notices for" "Not built" "Future"
        connectSphere.worker -> connectSphere.database "Would read due reminders from" "Not built" "Future"
        connectSphere.worker -> gateway "Would send email and SMS through" "Not built" "Future"
    }

    views {
        systemContext connectSphere "C1_SystemContext" "C1 System Context (release 1): the seven roles that use ConnectSphere. No external systems in release 1." {
            include *
            exclude "element.tag==Future"
            autoLayout tb
        }

        container connectSphere "C2_Containers" "C2 Containers (release 1): one web application, one API and one database; notifications stay in-app (ADR-003)." {
            include *
            exclude "element.tag==Future"
            autoLayout tb
        }

        component connectSphere.apiApp "C3_API_Components" "C3 Components of the API Application: eight feature areas (one Flask blueprint each) and five shared modules. Arrows follow the imports in backend/." {
            include *
            exclude "element.tag==Future"
            autoLayout lr 300 200
        }

        container connectSphere "Future_Deferred" "Deferred beyond release 1 (ADR-003): a worker and an email/SMS gateway, needed only if the customer asks for reminders (backlog SCRUM-74) or email/SMS. Dashed elements are not built." {
            include *
            autoLayout tb
        }

        styles {
            element "Person" {
                shape Person
                background #08427B
                color #ffffff
            }
            element "Internal" {
                background #005A9C
            }
            element "External" {
                background #4A90E2
            }
            element "Software System" {
                background #1168BD
                color #ffffff
            }
            element "External System" {
                background #999999
                color #ffffff
            }
            element "Container" {
                background #438DD5
                color #ffffff
            }
            element "Component" {
                background #85BBF0
                color #000000
            }
            element "Database" {
                shape Cylinder
                background #438DD5
            }
            element "Future" {
                border dashed
                opacity 60
            }
            relationship "Future" {
                dashed true
                color #999999
            }
        }
    }
}
