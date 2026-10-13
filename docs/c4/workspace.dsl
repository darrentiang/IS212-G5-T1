workspace "ConnectSphere" "Event Planning and Venue Booking System — release 1 (ADR-001, ADR-002, ADR-003)" {

    model {
        // --- People ---
        organiser = person "Event Organiser" "External client representative who submits and manages event requests." "External"
        attendee = person "Attendee" "External participant who registers for confirmed events open for registration." "External"

        coordinator = person "Event Coordinator" "Internal liaison who reviews, approves and plans events." "Internal"
        venueStaff = person "Venue Staff" "Internal staff who maintain venues and decide venue booking requests." "Internal"
        techStaff = person "Technical Support Staff" "Internal staff who maintain equipment and reservations." "Internal"
        safetyOfficer = person "Safety Officer" "Internal staff who review the operational safety of an event in Safety Check and approve or reject it." "Internal"

        // --- Software system in scope ---
        connectSphere = softwareSystem "ConnectSphere Platform" "Single system for planning events from request to confirmation: requests, approval, venues, equipment, registration, in-app notifications." {

            webApp = container "Web Application" "Responsive desktop and mobile interface for every role; calls the API through a single client module and shows only what the API allows." "React 19 / Vite / Tailwind CSS"

            apiApp = container "API Application" "Owns every business rule: role and relationship-based access (ADR-002), event state transitions, venue and equipment conflict detection, registrations, in-app notifications (ADR-003)." "Python / Flask / SQLAlchemy"

            database = container "Database" "Accounts and roles, event requests and their decisions, venues and layouts, venue bookings, equipment and reservations, registrations, notifications." "SQLite (development, CI); PostgreSQL only for a hosted demo (ADR-001)" "Database"
        }

        // Deferred beyond release 1 (ADR-003): Notification & Task Worker, external email/SMS gateway.

        // --- Relationships (Structurizr derives C1 from these) ---
        organiser -> webApp "Submits and manages event requests using" "HTTPS"
        attendee -> webApp "Registers for confirmed events using" "HTTPS"
        coordinator -> webApp "Reviews requests and plans events using" "HTTPS"
        venueStaff -> webApp "Maintains venues and decides bookings using" "HTTPS"
        techStaff -> webApp "Maintains equipment and reservations using" "HTTPS"
        safetyOfficer -> webApp "Reviews and decides safety checks using" "HTTPS"

        webApp -> apiApp "Makes API calls to (session cookie)" "JSON / HTTPS"
        apiApp -> database "Reads from and writes to" "SQL"
    }

    views {
        systemContext connectSphere "C1_SystemContext" "The people who use ConnectSphere. No external systems in release 1." {
            include *
            autoLayout tb
        }

        container connectSphere "C2_Containers" "The runtime containers of release 1." {
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
            element "Container" {
                background #438DD5
                color #ffffff
            }
            element "Database" {
                shape Cylinder
                background #438DD5
            }
        }
    }
}
