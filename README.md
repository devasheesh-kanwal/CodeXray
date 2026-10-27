# CodeXray

CodeXray is an agentic AI helper for large Python codebases. It indexes a repo
(tree-sitter skeleton, call/import graph, BM25 + Gemini embedding search) and
runs agent teams for architecture Q&A with verified `file:line` citations, PR
review, and a test-gated repair loop that patches bugs on a separate local
branch and waits for human approval.

| Folder | What |
|---|---|
| `Backend/` | Python + FastAPI backend. Setup, configuration and design: [Backend/README.md](Backend/README.md) |
| `Backend/docs/API.md` | The HTTP API contract the frontend uses |
| `Frontend Main/` | React + Vite + TypeScript frontend |

## Run it

Backend (from `Backend/`, after the setup in [Backend/README.md](Backend/README.md)):

```powershell
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

Frontend (from `Frontend Main/`; `.env` holds `VITE_API_BASE_URL=http://localhost:8000`
and `VITE_USE_MOCK=false`):

```powershell
npm install
npm run dev
```

Open http://localhost:5173. The backend's `FRONTEND_ORIGIN` must be exactly that URL (CORS).

## Settings and keys

Settings live in `.env` (repo root or `Backend/`; see `Backend/.env.example`).
`MOCK_MODE=false` turns on the real endpoints; `DEMO_MODE=true` answers only
from the on-disk caches (see "Demo cache" in [Backend/README.md](Backend/README.md)).
Provider keys go in `.env` only. Keep `.env` private: it is ignored by Git. If
keys were ever shared (for example pasted into a chat), rotate them in the
provider dashboards.

## Status

PR review (`/review`, `/rules`) is not built yet and returns `501 NOT_IMPLEMENTED`
with `MOCK_MODE=false`.
