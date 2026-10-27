# CodeXray

A small starter project for the CodeSense agent repair loop.

## Project layout

- `Backend/` — Python health-check API.
- `Frontend/` — static page showing the repair workflow.

## Run the backend

From the repository root, run:

```powershell
python Backend/main.py
```

The API listens on `http://localhost:8000`. Check `http://localhost:8000/health` for its status.

## View the frontend

Open `Frontend/index.html` in a browser. The page is a standalone static starter and does not require a build step.
