# CodeXray backend

FastAPI backend for CodeXray, an agentic helper for large codebases. The
frontend talks to it only through the HTTP API in [docs/API.md](docs/API.md).

Status: **prompt 3B**. All endpoints exist with their final request/response
shapes. With `MOCK_MODE=true` they return fixture data. These parts are
built:

- the LLM router (`app/llm/`)
- the indexing engine (`app/indexing/`)
- the agent framework (`app/agents/`)

With `MOCK_MODE=false`, the repo endpoints (`/repos`, `/status`, `/tree`,
`/graph`, `/file`) return real data. The Q&A, review and repair workflows
come in later prompts.

## Requirements

- Python 3.11 or newer (3.13 recommended)
- Run all commands below from the `Backend/` folder

## Setup

### Windows (PowerShell)

```powershell
cd Backend
py -3.13 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env    # then edit .env
```

If PowerShell refuses to run `Activate.ps1`, run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or call
`.venv\Scripts\python.exe` directly.

### Linux / macOS

```bash
cd Backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env    # then edit .env
```

## Configuration

Settings are read from the repo-root `.env`, then `Backend/.env` (which wins),
then real environment variables (which win over both). See
[.env.example](.env.example) for every setting.

`FRONTEND_ORIGIN` is required. If it is missing or invalid, the server stops
at startup with a message naming the bad setting.

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

- Health check: http://localhost:8000/api/health
- Swagger UI: http://localhost:8000/docs

## Test

```bash
python -m pytest
```

Tests never read `.env`, so no API keys are needed or loaded. LLM tests use
a fake HTTP transport, so they never reach a real provider.

## LLM router

Every LLM call goes through `LLMRouter` in `app/llm/router.py`:

```python
response = await router.ask("fast_small", [{"role": "user", "content": "..."}])
verdict, response = await router.ask_json("reviewer", messages, Verdict,
                                          exclude_models=["moonshotai/kimi-k2.6"])
async for item in router.stream("long_context", messages):
    ...  # str chunks, then one LLMResponse summary
```

Lanes (fallback chains) live in `app/llm/routes.yaml`. You can edit models
there without touching code. After changing it, check that every model works
with your keys:

```bash
python scripts/check_providers.py
```

That command sends one tiny real request per model (no cache) and prints a
table of working and failing models with their latency.

### How the LLM router switches

For each call, the router walks the lane's models in order:

- **Skipped without a request:** a model is skipped if it is in
  `exclude_models`, cooling down, missing from the provider's model list (the
  startup check), or has no working key. It is also skipped if the prompt is
  estimated to be too big for its `max_context`.
- **429 (rate limit):** that provider+model cools down for the `Retry-After`
  seconds (60 s if the header is missing), and the next model is tried
  immediately.
- **5xx or timeout:** one retry after 2 s, then the next model.
- **401 (bad key):** that key is disabled until restart, and the same model
  is tried with the provider's next key. If no keys are left, the next model
  is tried.
- **403 (model not allowed for this account):** only that model is skipped
  until restart. The keys stay enabled for the provider's other models.
- **400 "context too long":** the router jumps to the next model with a
  larger `max_context`.
- **Everything fails:** `AllProvidersFailed` is raised, listing each model
  and why it failed.

Tool calls keep the provider's `extra_content`. Gemini 3 requires its
`thought_signature` back on the next turn, and the router strips it before
sending to any other provider.

Answers are cached in `data/cache.sqlite`. With `DEMO_MODE=true` the router
answers only from that cache and never calls a provider. A streamed answer can
only switch models before its first chunk; after that, a failure raises
`LLMStreamError`.

## Indexing

Adding a repo (`POST /api/repos`, or the script below) runs these stages in
the background:

1. **cloning** (git URLs only): a shallow clone into `data/repos/<repo_id>/`.
2. **parsing**: tree-sitter reads every Python file into `skeleton.json`
   (imports, classes, methods, functions, signatures, line ranges). Files whose
   SHA-256 hash is unchanged are not parsed again.
3. **graph**: import edges (file → file) and call edges (function → function).
   Call edges are a heuristic. Each one is marked `exact` (resolved through
   the same file, `self`, or an import) or `name_match` (a unique name in the
   same file or an imported module).
4. **bm25**: one chunk per function, method, class header and per file's
   module-level code, plus a BM25 keyword index. The tokenizer is code-aware:
   `getUserById` → `getuserbyid get user by id`.
5. **embedding**: `gemini-embedding-2` vectors in Chroma.
   - Requests go in batches of 100 and back off on 429.
   - Vectors are cached on disk by hash, so unchanged code is never embedded
     twice.
   - If embedding fails, or `EMBEDDINGS=false`, search is BM25 only.
6. **summaries** (only with `FILE_SUMMARIES=true`): a one-line LLM summary
   per file.

Search (`RepoSearch.search`) merges BM25 and vector results with reciprocal
rank fusion. `build_context()` in `app/indexing/context.py` turns questions
into labelled `[file:start-end]` snippets that fit a token budget.

Index a repo from the command line. This uses the same data folder as the
server, and prints the time per stage and the number of embedding API calls:

```bash
python scripts/index_repo.py path/to/repo
```

Chroma installs `onnxruntime` for its own local embedding function. CodeXray
never uses it: collections are created without an embedding function and
always receive Gemini vectors.

Things to know:
- **Free-tier speed:** Gemini's free tier allows 100 embedded texts per minute.
  The first index of a repo with N chunks takes about N/100 minutes. While it
  waits, the embedder sleeps for as long as Gemini's `retryDelay` says. Later
  runs embed only changed chunks.
- **One indexer at a time:** don't start the server while
  `scripts/index_repo.py` is running. At startup the server marks
  half-finished repos as `failed`.
- **`best_score` floor:** with real Gemini vectors, unrelated questions still
  score about 0.6, and relevant ones about 0.75. Any "not found" threshold
  must be calibrated on real queries.

## Agents

Every agent in `app/agents/roster.py` has:

- one job
- a system prompt in `app/agents/prompts/<name>.md`
- typed input and output (Pydantic)
- an LLM lane, an allow-list of tools, and a maximum step count

| Agent | Lane | Tools |
|---|---|---|
| architect | long_context | search_code, read_skeleton, get_neighbors, read_file |
| architect (Q&A, `app/qa/agents.py`) | fast_small | search_code, read_skeleton, get_neighbors |
| explainer | long_context | read_file (streams plain text) |
| code_reviewer | heavy_code | search_code, get_neighbors, read_file |
| debugger | heavy_code | search_code, get_neighbors, read_file, read_test_output |
| repair | heavy_code | read_file, read_test_output, write_patch |
| reviewer | reviewer | read_file, read_test_output |
| summarizer | fast_small | none |

How a run works:

1. **The Coordinator** (`coordinator.py`, plain code) runs a workflow as an
   explicit state machine. Each state has one handler that returns the next
   state.
2. **Agents never call each other.** They share data only through `RunState`.
   `RunState` is saved to `data/runs/<run_id>.json` after every step, so a page
   refresh can rebuild the timeline.
3. **Each agent step** either calls a tool or gives the final answer.
   - Native tool calling is used first.
   - If the providers reject tools, or the model sends broken tool calls, the
     agent switches to a JSON protocol: `{"action": ..., "args": ...}` /
     `{"final": ...}`.
   - At `max_steps` it asks once for a final answer, else it raises
     `AgentStepLimit`.
4. **Tools are permission-checked.** A tool outside the agent's allow-list
   returns an error to the model and is never run. Long tool results end in
   `[truncated]`.
5. **`write_patch`** only works inside a repair worktree. It refuses any diff
   that touches test files.
6. **Budgets** apply per run: 25 LLM calls, 200k tokens and 300 s by default.
   Running out stops the run with a clear reason.
7. **Events** go to an in-memory bus for SSE: `agent_started`, `tool_call`,
   `tool_result`, `agent_output`, `agent_error`, `citation_dropped`,
   `state_change` and `run_finished`. `build_agent_trace()` turns them into
   the API's `agent_trace`.
8. **Plain-text agents** (the Explainer) use `Agent.stream_text()`: the answer
   streams chunk by chunk. A reply that is only
   `{"action": "<tool>", "args": {...}}` is a tool call. It is not streamed;
   the tool runs and the model is asked again.

## Q&A (`app/qa/`)

`POST /ask` and `/ask/stream` run one workflow (`workflow.py`):

1. **Architect** (`agents.py`, fast_small, at most 6 steps) searches with
   `search_code`, `read_skeleton` and `get_neighbors`. It returns the
   relevant line ranges.
2. **Not-found gate** (plain code). The answer is "No relevant code found for
   this question" when:
   - the Architect found nothing, or
   - the best score of the Architect's own searches is below the threshold
     (`NOT_FOUND_THRESHOLD`, or `NOT_FOUND_THRESHOLD_BM25` in bm25_only mode).

   The score is recorded by the `search_code` tool, not reported by the LLM.
   In this case the Explainer is never called.
3. **Context** (plain code): the chosen ranges become `[file:start-end]`
   snippets within `QA_CONTEXT_TOKENS`.
4. **Explainer** (long_context) streams plain text with a marker after every
   claim, or a first line `NOT_FOUND`. It may read up to 2 more ranges.
5. **Citation checker** (`citations.py`, plain code) keeps a marker only if:
   - the file is indexed,
   - the lines exist, and
   - the range overlaps code the Explainer received.

   It logs every dropped marker. Confidence is 0.9, 0.6 or 0.3 (all, some, or
   most markers verified). If every marker is dropped, the result is not_found.

Measure it on the demo repo: fill in the TODOs in `tests/qa_eval.yaml`, then:

```bash
python scripts/eval_qa.py <repo_id>
```

This prints pass/fail per question, citation accuracy, average Architect
steps, average LLM calls and average latency. Use it to calibrate the two
thresholds.

## Layout

```
app/
  main.py      app factory: CORS, error handlers, routers
  config.py    settings from .env (fail fast)
  errors.py    the one error format: {"error": {code, message, details}}
  api/         thin FastAPI routers + Pydantic request/response models
  mocks/       MOCK_MODE fixtures (JSON) and the scripted repair run
  llm/         LLM router: routes.yaml lanes, switching, cache, status
  indexing/    skeleton, graph, chunks, BM25, embeddings, search, context
  agents/      base Agent, tools, RunState, coordinator, event bus, roster, prompts/
  qa/          Q&A workflow: QA architect, citation checker, service
  review/ repair/   filled in by later prompts
docs/API.md    contract for the frontend
scripts/       check_providers.py, index_repo.py, eval_qa.py
tests/         pytest (tests/llm/ router, tests/indexing/ indexing, tests/agents/
               agents with a scripted fake LLM, tests/qa/ Q&A, qa_eval.yaml,
               tests/fixtures/sample_repo/)
data/          created at runtime: indexes, caches, runs (gitignored)
```
