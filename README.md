# Crisis Sentinel

Containerized tactical emergency triage starter platform:

- **backend/**: FastAPI API with report intake and priority sorting
- **frontend/**: React + Leaflet + Tailwind dispatcher dashboard
- **simulator/**: Python script that pushes mock crisis reports

## Quick start

From the repository root:

```bash
docker compose up --build
```

Open:

- Frontend dashboard: http://localhost:5173
- Backend API docs: http://localhost:8000/docs

## API overview

- `POST /report` accepts:
  - `transcription` (raw text)
  - `report_type` (`civilian` or `military`)
  - `location` (`latitude`, `longitude`, optional `label`)
- `GET /reports` returns active reports sorted by urgency score (highest first).

## Run simulator

In a second terminal (while compose is running):

```bash
docker compose run --rm --profile tools simulator
```
