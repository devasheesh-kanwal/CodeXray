# CodeXray

CodeXray is a small repository assistant prototype. Its backend indexes Python symbols and calls, retrieves relevant source excerpts, and routes requests to architecture Q&A, PR review, repair proposal, or evaluation agents.

## Run the backend

Provider credentials and defaults can be set in the root `.env` file. The backend loads it automatically; process environment values take precedence. `LLM_PROVIDER=auto` tries configured providers in the order in `LLM_FALLBACK_PROVIDERS`. For a single preferred provider, set `LLM_PROVIDER` to `nvidia`, `groq`, `gemini`, `openrouter`, `deepseek`, or `ollama`.

Run from the repository root:

```powershell
python Backend/main.py
```

For key rotation, use comma-separated variables such as `GROQ_API_KEYS` or `NVIDIA_API_KEYS`; the singular `*_API_KEY` form also works. Invalid credentials are cooled down for an hour, rate-limited credentials for one minute, and transient failures for 20 seconds. The client then tries the next key and provider. Cooldowns reset when the process restarts. Failed attempts only log provider names and HTTP status codes, never key values or provider response bodies.

Default model IDs are set in `.env` and can be overridden with `NVIDIA_MODEL`, `GROQ_MODEL`, `GEMINI_MODEL`, `OPENROUTER_MODEL`, `DEEPSEEK_MODEL`, or `OLLAMA_MODEL`. Provider quotas and free access vary: OpenRouter's `openrouter/free` routes to currently available free models; NVIDIA's selected NIM endpoint is listed as a free prototype endpoint; Gemini's free tier has limited model access; Groq has developer-tier quotas; DeepSeek direct API is metered; Ollama Cloud may consume starter credits or paid credits. Failover does not guarantee free service or separate quotas across keys.

Keep `.env` private. The file is ignored by Git and has been removed from Git tracking while remaining on disk. These credentials were pasted into chat, so rotate them in the provider dashboards if they should remain private.

The server defaults to `http://127.0.0.1:8000`; set `HOST` or `PORT` to change that. `CODEXRAY_REPO` can point indexing at a different repository.

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
