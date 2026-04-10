# CourtX Backend (Phase 1)

FastAPI backend scaffold for an MVP real-time basketball analytics platform with Supabase integration.

## Features Implemented

- FastAPI project structure with modular layers:
  - `app/api` for endpoints
  - `app/services` for VLM/LLM interfaces
  - `app/models` for request/response schemas
  - `app/core` for config, auth, and Supabase client
- Supabase JWT verification dependency (Bearer token auth)
- `POST /api/upload-video` endpoint:
  - Uploads file to Supabase Storage
  - Creates a `raw_logs` record with `session_id`
- `GET /api/alerts` endpoint for coach alert retrieval
- Supabase SQL migration for:
  - `profiles`
  - `raw_logs`
  - `alerts`

## Project Structure

```text
courtX/
├── app/
│   ├── api/
│   │   ├── alerts.py
│   │   └── upload.py
│   ├── core/
│   │   ├── auth.py
│   │   ├── config.py
│   │   └── supabase.py
│   ├── models/
│   │   └── schemas.py
│   ├── services/
│   │   ├── base.py
│   │   └── placeholders.py
│   └── main.py
├── sql/
│   └── 001_init_supabase_schema.sql
└── requirements.txt
```

## Setup

1. Create and activate a Python 3.10+ virtual environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Create `.env` in the project root:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_KEY=YOUR_SUPABASE_ANON_OR_SERVICE_KEY
SUPABASE_STORAGE_BUCKET=videos
MIXPANEL_TOKEN=optional_for_now
```

## Supabase Initialization

1. In Supabase SQL editor, run:
   - `sql/001_init_supabase_schema.sql`
2. In Supabase Storage, create a bucket named `videos` (or set a custom bucket with `SUPABASE_STORAGE_BUCKET`).

## Run Server

```bash
uvicorn app.main:app --reload
```

Server starts at `http://127.0.0.1:8000`.

## API Endpoints

- `GET /health`
- `POST /api/upload-video` (requires `Authorization: Bearer <supabase_jwt>`)
- `GET /api/alerts` (requires `Authorization: Bearer <supabase_jwt>`)

## Notes on AI Modularity

- `BaseVLMService` and `BaseLLMService` are abstract contracts for future provider integrations.
- `PlaceholderVLMService` and `PlaceholderLLMService` are no-op stubs for MVP scaffolding.
- This keeps AI provider choice (OpenAI/Gemini/other) swappable without changing API/business layers.
