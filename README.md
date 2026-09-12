# IS212-G5-T1 — ConnectSphere Event Planning & Venue Booking System

Monorepo for the IS212 group project.

## Project Structure

```
backend/    Python Flask API
frontend/   React + Vite + Tailwind CSS
```

## Prerequisites

- Python 3.12+
- Node.js 22+
- npm 10+

## Running the Backend

```bash
cd backend
pip install -r requirements.txt
python app.py
```

Flask starts on `http://localhost:5000`.

## Running the Frontend

```bash
cd frontend
npm install
npm run dev
```

Vite starts on `http://localhost:5173`. API requests to `/api/*` are proxied to the backend.

## Endpoints

| Method | Path | Response |
|---|---|---|
| GET | `/api/health` | `{"status": "ok"}` |
| GET | `/api/ping` | `{"message": "pong"}` |
