workspace "ConnectSphere" "Event Planning and Venue Booking System, release 1. C4 model v3 (history: docs/c4/change-history.md)." {

    !identifiers hierarchical

    model {
        // --- People ---
        organiser = person "Event Organiser" "Client who submits event requests, answers clarifications and asks for changes or withdrawal." "External"
        attendee = person "Attendee" "Registers for Confirmed events, and views or withdraws registrations." "External"
        coordinator = person "Event Coordinator" "Plans only their assigned events: decisions, venues, equipment, safety check, edits, change requests." "Internal"
        coordinatorLead = person "Event Coordinator Lead" "Assigns new requests from the unassigned queue, reassigns events, sees all assignments." "Internal"
        venueStaff = person "Venue Staff" "Maintains venues, their times and blocks, and decides venue bookings." "Internal"
        techStaff = person "Technical Support Staff" "Maintains equipment, checks availability and reserves equipment." "Internal"
        safetyOfficer = person "Safety Officer" "Reviews events in Safety Check: approves, rejects or returns them for changes." "Internal"

        // --- Software system in scope ---
        connectSphere = softwareSystem "ConnectSphere Platform" "Takes an event from request to completion: review, venues, equipment, safety check, registration, notifications." {
            webApp = container "Web Application" "Interface for every role. Shows only what the API allows." "React 19, Vite, Tailwind CSS"
            apiApp = container "API Application" "Owns every business rule: access (ADR-002), status changes, conflicts, holds, in-app notifications (ADR-003)." "Python, Flask, SQLAlchemy"
            database = container "Database" "Accounts, events, venues, bookings, holds, equipment, registrations, change requests, notifications." "SQLite (ADR-001)" "Database"
        }

        // Deferred beyond release 1 (ADR-003): a notification worker and an email/SMS gateway.

        // --- Relationships (Structurizr derives C1 from these) ---
        organiser -> connectSphere.webApp "Submits and follows event requests using" "HTTPS"
        attendee -> connectSphere.webApp "Registers for events using" "HTTPS"
        coordinator -> connectSphere.webApp "Plans assigned events using" "HTTPS"
        coordinatorLead -> connectSphere.webApp "Assigns coordinators using" "HTTPS"
        venueStaff -> connectSphere.webApp "Manages venues and bookings using" "HTTPS"
        techStaff -> connectSphere.webApp "Manages equipment using" "HTTPS"
        safetyOfficer -> connectSphere.webApp "Decides safety checks using" "HTTPS"

        connectSphere.webApp -> connectSphere.apiApp "Makes API calls to" "JSON over HTTPS, session cookie"
        connectSphere.apiApp -> connectSphere.database "Reads from and writes to" "SQL"
    }

    views {
        systemContext connectSphere "C1_SystemContext" "C1 System Context: the seven roles that use ConnectSphere. No external systems in release 1." {
            include *
            autoLayout tb
        }

        container connectSphere "C2_Containers" "C2 Containers: web application, API and database. Notifications stay in-app (ADR-003)." {
            include *
            autoLayout tb
        }

        styles {
            element "Element" {
                fontSize 24
            }
            element "Person" {
                shape Person
                width 520
                height 440
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
                width 600
                height 380
                background #1168BD
                color #ffffff
            }
            element "Container" {
                width 560
                height 360
                background #438DD5
                color #ffffff
            }
            element "Database" {
                shape Cylinder
                height 420
                background #438DD5
            }
        }
    }
}
