# CodeXray

CodeXray is a small repository assistant prototype. Its backend indexes Python symbols and calls, retrieves relevant source excerpts, and routes requests to architecture Q&A, PR review, repair proposal, or evaluation agents.

## Run the backend

Set a provider and its API key in the environment, then run from the repository root:

```powershell
$env:LLM_PROVIDER = "groq"
$env:GROQ_API_KEY = "your-key"
python Backend/main.py
```

Supported providers are `groq`, `openrouter`, and `gemini`. Use `GROQ_API_KEY`, `OPENROUTER_API_KEY`, or `GEMINI_API_KEY` respectively. Optional model overrides are `GROQ_MODEL`, `OPENROUTER_MODEL`, and `GEMINI_MODEL`. The server defaults to `http://127.0.0.1:8000`; set `HOST` or `PORT` to change that. `CODEXRAY_REPO` can point indexing at a different repository.

## API

- `GET /health` returns service status.
- `POST /agent` accepts a JSON body with `task`, `prompt`, and optional `token_budget`.

Available tasks: `architecture`, `review`, `repair`, and `evaluate`. Example:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/agent `
  -ContentType "application/json" `
  -Body '{"task":"architecture","prompt":"Where is the API server created?"}'
```

The repair agent returns a proposal for human review; it does not edit files, run code, create branches, or merge changes. Evaluation reviews supplied change and result text and does not run tests. Retrieval is a local, dependency-free lexical baseline with `[file:line]` citations. The static frontend is in `Frontend/index.html`.
