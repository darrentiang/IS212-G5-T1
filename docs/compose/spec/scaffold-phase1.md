---
feature: scaffold-phase1
status: delivered
updated: 2026-09-13
branch: feature/scaffold-phase1
commits: 7094e8b..<pending>
---

# Scaffold Phase 1 — Skeleton

## Report

**What was built** — A monorepo skeleton for the ConnectSphere Event Planning system. Backend is a Flask app with two endpoints (`/api/health`, `/api/ping`) and CORS enabled. Frontend is a React 19 + Vite 8 + Tailwind CSS 4 app with a single page that calls the backend via a Vite dev-server proxy. A `.gitignore` keeps the repo clean of `node_modules`, `__pycache__`, and build artifacts.

**Verification** — Flask test client confirmed both endpoints return 200 with correct JSON. Frontend `vite build` completed with zero errors. `git status` shows only intended files.

**Journey log** — Vite 8's default scaffold ships with a more elaborate starter page than older versions; replaced entirely with the ConnectSphere ping page. Tailwind CSS 4 uses the `@tailwindcss/vite` plugin approach (no `postcss.config.js` needed).

## [S1] Problem

The team needs a working monorepo skeleton so that any member can clone the repo, run two commands, and see a React frontend talking to a Flask backend in the browser. Without this, there is no foundation for tests, CI, or feature development.

## [S2] Design

### Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 7 + Tailwind CSS 4 |
| Backend | Python Flask |
| Persistence | None (Phase 1 is a skeleton only) |

### Backend contract

Flask app with CORS enabled, two endpoints:

- `GET /api/health` → `200 OK`, body `{"status": "ok"}`
- `GET /api/ping` → `200 OK`, body `{"message": "pong"}`

Runs on port 5000. Entry point: `backend/app.py`.

### Frontend contract

Vite dev server on port 5173. Proxies `/api/*` to `http://localhost:5000`.

Single page (`App.jsx`):
- Renders a heading ("ConnectSphere Event Planning")
- Renders a button labeled "Ping Backend"
- On click, calls `GET /api/ping` and displays the response message below the button
- On error, displays an error message

Tailwind CSS 4 is configured. No component library.

### File structure created

```
backend/
  app.py
  requirements.txt
frontend/
  src/
    main.jsx
    App.jsx
    index.css
  index.html
  vite.config.js
  package.json
  postcss.config.js (if needed by Tailwind 4)
.gitignore
README.md
```

### Verification

1. `cd backend && pip install -r requirements.txt && python app.py` → Flask on :5000
2. `cd frontend && npm install && npm run dev` → Vite on :5173
3. Browser at :5173 → page renders → click "Ping Backend" → "pong" displayed
4. Both terminals killed and restarted → same result

## [S3] Out of Scope

- DataStore / persistence
- Event CRUD endpoints
- Any tests (Phase 3)
- CI pipeline (Phase 4)
- Google Sheets logging (Phase 4)
- Skills (Phase 5)
- Auth, roles, user management

## Tasks

- [x] T1: Create backend Flask app with /api/health and /api/ping — acceptance: `python app.py` starts, `curl localhost:5000/api/health` returns `{"status":"ok"}` (covers: S2)
- [x] T2: Scaffold frontend with Vite + React + Tailwind — acceptance: `npm run dev` starts, browser shows page at :5173 (covers: S2; depends: T1)
- [x] T3: Wire frontend to backend via Vite proxy — acceptance: clicking "Ping Backend" displays "pong" from Flask (covers: S2; depends: T2)
- [x] T4: Add .gitignore and README — acceptance: `git status` shows no noise (node_modules, __pycache__, etc.) (covers: S2; depends: T1)
