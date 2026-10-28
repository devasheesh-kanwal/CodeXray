# CodeXray API

The contract between the CodeXray backend and the frontend. Every endpoint
listed here exists now. With `MOCK_MODE=true` they all return fixture data
for a small demo repo (`flask-todo`), so the frontend can be built before
the real indexing and agents exist.

- Base URL (local): `http://localhost:8000`
- Interactive docs: `http://localhost:8000/docs` (Swagger UI), schema at `/openapi.json`
- All request and response bodies are JSON, except the two SSE streams.
- File paths in responses are repo-relative with `/` separators (`app/db.py`).
- Line numbers are 1-based and ranges are inclusive (`start_line`..`end_line`).
- Fields marked `?` may be `null`.

## Contents

- [Running in mock mode](#running-in-mock-mode)
- [Error format](#error-format)
- [Shared types](#shared-types)
- [Endpoints](#endpoints)
  - Health: [GET /api/health](#get-apihealth)
  - Repos: [GET /api/repos](#get-apirepos) ·
    [POST /api/repos](#post-apirepos) ·
    [status](#get-apireposrepo_idstatus) ·
    [tree](#get-apireposrepo_idtree) ·
    [graph](#get-apireposrepo_idgraph) ·
    [file](#get-apireposrepo_idfile) ·
    [rules](#get-apireposrepo_idrules)
  - Q&A: [ask](#post-apireposrepo_idask) ·
    [ask/stream (SSE)](#post-apireposrepo_idaskstream-sse)
  - Review: [review](#post-apireposrepo_idreview)
  - Repair: [start](#post-apireposrepo_idrepair) ·
    [get run](#get-apirepairsrun_id) ·
    [events (SSE)](#get-apirepairsrun_idevents-sse) ·
    [approve / reject](#post-apirepairsrun_idapprove-and-post-apirepairsrun_idreject)
  - LLM: [GET /api/llm/status](#get-apillmstatus) ·
    [GET /api/llm/models](#get-apillmmodels) ·
    [PUT /api/llm/selection](#put-apillmselection)
  - Embeddings: [GET /api/embeddings](#get-apiembeddings) ·
    [PUT /api/embeddings/selection](#put-apiembeddingsselection)
- [Repair states](#repair-states)
- [Reading SSE from the browser](#reading-sse-from-the-browser)

---

## Running in mock mode

See `Backend/README.md` for full setup. In short, from the `Backend/` folder:

```bash
# .env (repo root or Backend/) must contain at least:
#   MOCK_MODE=true
#   FRONTEND_ORIGIN=http://localhost:5173   <- the exact origin your frontend runs on
uvicorn app.main:app --reload --port 8000
```

`FRONTEND_ORIGIN` is the only origin allowed by CORS. If the frontend runs
on another port, change it and restart the server.

In mock mode:

- Any `repo_id` is accepted, and every repo returns the same demo repo data.
- `POST /api/repos` returns a new random `repo_id` with status `queued`.
- A repair run is real in one sense: it moves through its states over about
  20 seconds after you start it, so you can build the live progress UI.
- With `MOCK_MODE=false`, these endpoints return real data:
  - `/api/health`
  - `/api/llm/status`, `/api/llm/models`, `/api/llm/selection`
  - `/api/embeddings`, `/api/embeddings/selection`
  - the repo endpoints: `GET/POST /api/repos`, `/status`, `/tree`, `/graph`, `/file`
  - Q&A: `/ask` and `/ask/stream`
  - Repair: `POST /api/repos/{repo_id}/repair` and every `/api/repairs/...` endpoint

  Every other endpoint returns `501 NOT_IMPLEMENTED` until its feature is built.

---

## Error format

Every error from every endpoint has the same shape:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Repair run not found",
    "details": {"run_id": "run_nope"}
  }
}
```

| HTTP | `code` | When |
|---|---|---|
| 404 | `NOT_FOUND` | Unknown route, repo, file, or repair run |
| 405 | `METHOD_NOT_ALLOWED` | Wrong HTTP method for a route |
| 409 | `INVALID_STATE` | Approve/reject a run that is not `AWAITING_APPROVAL`; ask about (or repair) a repo that is not indexed (`ready`) yet; start a repair while another repair run for the same repo is still active; repair a repo that is not the root of a local git repository |
| 422 | `VALIDATION_ERROR` | Bad body, query, or line range |
| 500 | `INTERNAL_ERROR` | Unexpected server error (no internals are leaked) |
| 501 | `NOT_IMPLEMENTED` | Feature not built yet and `MOCK_MODE=false` |
| 503 | `LLM_UNAVAILABLE` | No language model could answer (all providers failed or rate-limited, or the run's budget ran out). `details.run_id` names the run. Try again later |

For `VALIDATION_ERROR` caused by the request shape, `details.errors` lists
each problem:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request is invalid",
    "details": {
      "errors": [
        {"field": "body.question", "message": "String should have at least 1 character"}
      ]
    }
  }
}
```

`details` is always an object (possibly empty). Show `message` to the user;
switch on `code` in code.

---

## Shared types

**AgentTraceStep**: one step an agent took. Used in `agent_trace` arrays.

```json
{"agent": "architect", "step": 1, "action": "search_symbols",
 "summary": "Searched the skeleton for auth-related symbols; found login_required and verify_token in app/auth.py.",
 "ms": 410}
```

| Field | Type | Notes |
|---|---|---|
| agent | string | e.g. `architect`, `explainer`, `citation_checker`, `static_analyzer`, `code_reviewer` |
| step | int ≥ 1 | Order within the request |
| action | string | Short machine name of what it did |
| summary | string | One human-readable sentence |
| ms | int ≥ 0 | Time taken |

**Citation**

```json
{"file": "app/auth.py", "start_line": 12, "end_line": 25,
 "why": "Defines login_required, which checks the bearer token and sets g.user."}
```

---

## Endpoints

### GET /api/health

```json
{"status": "ok", "version": "0.1.0", "mock_mode": true, "demo_mode": false}
```

### GET /api/repos

Returns a bare array.

```json
[
  {"repo_id": "repo_flask_todo", "name": "flask-todo", "status": "ready", "files_total": 7}
]
```

`status` is one of these stages, in order: `queued`, `cloning`, `parsing`,
`graph`, `bm25`, `embedding`, `summaries`, `ready`. It is `failed` if
indexing failed. `cloning` happens only for git URLs, and `summaries` only
when the server has file summaries turned on.

### POST /api/repos

Start indexing a repo. Send **exactly one** of `git_url` or `local_path`.

```json
{"git_url": "https://github.com/someone/flask-todo.git"}
```
```json
{"local_path": "C:/code/flask-todo"}
```

Response `202 Accepted` (indexing continues in the background):

```json
{"repo_id": "flask-todo-3f9c1a2b", "status": "queued"}
```

- The same `git_url` or `local_path` always gets the same `repo_id`.
  Posting it again re-indexes the repo. Unchanged files are not parsed or
  embedded again.
- `git_url` must start with `https://`, `ssh://` or `git@`. The repo is cloned
  shallow (latest commit only).
- `local_path` must be an existing folder on the server's machine.
- Only Python files are indexed. These are skipped:
  - `.git`, `venv`, `.venv`, `node_modules`, `__pycache__`, `build`, `dist`
  - binary files, `.env` files, and files over 200 KB
  - anything matched by `.gitignore`

| Problem | Response |
|---|---|
| Both or neither field, bad URL, or missing folder | `422 VALIDATION_ERROR` |
| This repo is already being indexed | `409 INVALID_STATE` |

### GET /api/repos/{repo_id}/status

Poll this while indexing (every 1–2 s is fine).

```json
{
  "stage": "ready",
  "files_done": 7,
  "files_total": 7,
  "error": null,
  "chunks_total": 19,
  "chunks_embedded": 19,
  "search_mode": "hybrid"
}
```

- `stage` uses the same values as repo `status`. `error?` is set when `stage` is `failed`.
- `files_done` counts up during `parsing`.
- `chunks_total?` (search units: one per function, method, class header, and
  module-level code), `chunks_embedded?` and `search_mode?` are `null` until
  the stage that sets them.
- `search_mode` (for the embedding provider selected right now, see
  [GET /api/embeddings](#get-apiembeddings)):
  - `hybrid`: keyword plus meaning-based search.
  - `bm25_only`: keyword search only, because embeddings are off, unavailable,
    or failed, or because the repo has no vectors from the selected provider
    yet (they are being added after a switch). `chunks_embedded` shows how many
    chunks got a vector before that.
- Unknown `repo_id` → `404 NOT_FOUND`.

### GET /api/repos/{repo_id}/tree

The skeleton: folders contain `children`, files contain `symbols`, and
symbols can nest. In real mode the nesting is classes → methods. Line ranges
of decorated functions start at the first decorator.

Before the first indexing finishes, `/tree`, `/graph` and `/file` return
`409 INVALID_STATE` with `details.stage`. While a repo is being re-indexed,
they keep serving the previous index.

```json
{
  "repo_id": "repo_flask_todo",
  "root": {
    "name": "flask-todo", "path": "", "type": "folder", "symbols": [],
    "children": [
      {
        "name": "app", "path": "app", "type": "folder", "symbols": [],
        "children": [
          {
            "name": "models.py", "path": "app/models.py", "type": "file", "children": [],
            "symbols": [
              {
                "name": "Todo", "kind": "class", "start_line": 5, "end_line": 16,
                "children": [
                  {"name": "from_row", "kind": "method", "start_line": 12, "end_line": 13, "children": []},
                  {"name": "to_dict", "kind": "method", "start_line": 15, "end_line": 16, "children": []}
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}
```

(Shortened: the real response has every file.)

| TreeNode field | Type | Notes |
|---|---|---|
| name | string | Last path part |
| path | string | Repo-relative; `""` for the root |
| type | `folder` \| `file` | |
| children | TreeNode[] | Empty for files |
| symbols | Symbol[] | Empty for folders |

| Symbol field | Type |
|---|---|
| name | string |
| kind | `class` \| `function` \| `method` |
| start_line, end_line | int |
| children | Symbol[] |

### GET /api/repos/{repo_id}/graph

Approximate import/call graph, ready for a graph library.

```json
{
  "nodes": [
    {"id": "file:app/routes.py", "label": "app/routes.py", "type": "file", "file": "app/routes.py"},
    {"id": "func:app/routes.py:delete_todo", "label": "delete_todo", "type": "function", "file": "app/routes.py"},
    {"id": "class:app/models.py:Todo", "label": "Todo", "type": "class", "file": "app/models.py"}
  ],
  "edges": [
    {"source": "file:app/routes.py", "target": "func:app/routes.py:delete_todo", "type": "contains"},
    {"source": "func:app/routes.py:delete_todo", "target": "class:app/models.py:Todo", "type": "calls"},
    {"source": "file:app/routes.py", "target": "file:app/models.py", "type": "imports"}
  ]
}
```

- **Node `type`:** `file`, `class`, `function` (methods are `function` nodes
  labelled `Class.method`).
- **Edge `type`:** `imports` (file → file, local files only), `contains`
  (file → class/function, class → method), `calls` (function → function or
  class).
- **Node `id`:** treat it as an opaque string.
- **Call edges are best-effort:** they come from matching call names to
  definitions in the same file or in imported modules, so some calls are
  missing.

### GET /api/repos/{repo_id}/file

Query parameters:

| Param | Required | Default | Notes |
|---|---|---|---|
| path | yes | | Repo-relative, e.g. `app/auth.py` |
| start | no | 1 | ≥ 1 |
| end | no | last line | Inclusive; clamped to file length |

`GET /api/repos/repo_flask_todo/file?path=app/auth.py&start=6&end=9`

```json
{
  "path": "app/auth.py",
  "start": 6,
  "end": 9,
  "lines": [
    "def verify_token(token):",
    "    \"\"\"Return the user name for a valid API token, else None.\"\"\"",
    "    tokens = current_app.config[\"API_TOKENS\"]",
    "    return tokens.get(token)"
  ]
}
```

- `lines[0]` is line `start`.
- `start` past the end of the file, or `end < start` → `422 VALIDATION_ERROR`.
- `404 NOT_FOUND` for:
  - a path that isn't an indexed file
  - anything outside the repo folder, such as `../`
  - an unknown repo

### GET /api/repos/{repo_id}/rules

Design rules the PR review checks.

```json
{
  "rules": [
    {"id": "R1", "title": "Every route requires login",
     "description": "Every Flask route in app/routes.py must be wrapped in @login_required.",
     "severity": "high", "enabled": true},
    {"id": "R4", "title": "Database access through get_db",
     "description": "Open SQLite connections only via app.db.get_db, never sqlite3.connect directly.",
     "severity": "low", "enabled": false}
  ]
}
```

### POST /api/repos/{repo_id}/ask

Request:

```json
{"question": "How does authentication work for the todo API?"}
```

`question`: 1–2000 characters.

Response:

```json
{
  "answer": "Every todo endpoint is wrapped in the login_required decorator [app/auth.py:12-25]. It reads the 'Authorization: Bearer <token>' header, looks the token up with verify_token [app/auth.py:6-9], and aborts with 401 if the token is unknown; otherwise it stores the user name in g.user. The routes then use g.user to scope their queries to the caller, for example list_todos only selects rows whose owner matches [app/routes.py:12-16]. Valid tokens come from the API_TOKENS setting in config.Config.",
  "citations": [
    {"file": "app/auth.py", "start_line": 12, "end_line": 25, "why": "Defines login_required, which checks the bearer token and sets g.user."},
    {"file": "app/auth.py", "start_line": 6, "end_line": 9, "why": "verify_token maps a token to a user name using the API_TOKENS config."},
    {"file": "app/routes.py", "start_line": 12, "end_line": 16, "why": "list_todos filters rows by owner = g.user, showing how the user is used."}
  ],
  "confidence": 0.86,
  "not_found": false,
  "provider": "groq",
  "model": "llama-3.3-70b-versatile",
  "cached": false,
  "agent_trace": [
    {"agent": "architect", "step": 1, "action": "search_symbols", "summary": "Searched the skeleton for auth-related symbols; found login_required and verify_token in app/auth.py.", "ms": 410},
    {"agent": "architect", "step": 2, "action": "find_callers", "summary": "Graph shows login_required is applied to all three routes in app/routes.py.", "ms": 120},
    {"agent": "explainer", "step": 3, "action": "read_file", "summary": "Read app/auth.py:1-25 and app/routes.py:10-16 and wrote the answer.", "ms": 2380},
    {"agent": "citation_checker", "step": 4, "action": "verify_citations", "summary": "3 of 3 citations exist in the index and match the cited line ranges.", "ms": 15}
  ]
}
```

- `answer` is plain text with inline citation markers `[file:start-end]`.
  Each marker matches one entry in `citations`, so you can turn markers into
  links that open `/file?path=...&start=...&end=...`.
- Every citation is verified by the backend: the file is indexed, the lines
  exist, and the range overlaps code the Explainer was given. Markers that fail
  this check are removed from `answer`, and every kept marker is written as
  `[file:start-end]` (a model's `` `file:5` `` or `[file:5]` becomes `[file:5-5]`, and a
  grouped `[a.py:1-2, b.py:5]` becomes `[a.py:1-2] [b.py:5-5]`, each checked on its own).
- `not_found: true` means no relevant code was found. `answer` is then exactly
  `"No relevant code found for this question"`, `citations` is empty and
  `confidence` is 0.
- `confidence` is between 0 and 1: `0.9` when every marker was verified,
  `0.6` when some were dropped, `0.3` when more than half were dropped or the
  answer has no markers. `cached` is true when the answer came from the LLM
  cache. `agent_trace?` may be `null`.
- Errors: `404` unknown repo, `409` repo not indexed yet, `503 LLM_UNAVAILABLE`
  when no model could answer.

### POST /api/repos/{repo_id}/ask/stream (SSE)

Same request body as `/ask`. Response is `text/event-stream`. Input is
validated first, so a bad body (`422`), an unknown repo (`404`) or a repo that
is not indexed yet (`409`) returns a normal JSON error instead of a stream.

Events, in order:

| Event | Data | Notes |
|---|---|---|
| `agent` | `{"agent": "architect", "status": "running", "detail": "searching code"}` | Zero or more, while agents work, all before the first `token`. `status`: `running`, `done`, `failed`. `agent`: `architect`, `explainer`, `citation_checker`. `detail?` is a short label for the UI and may be `null` |
| `token` | `{"text": "..."}` | Answer text chunks. Concatenate them in order |
| `final` | `{citations, confidence, not_found, provider, model, agent_trace}` | Same meaning as in `/ask` |
| `done` | `{}` | Stream finished successfully |
| `error` | `{"code", "message", "details"}` | Sent instead of `final`/`done` if something fails mid-stream |

Raw stream (start and end):

```
event: agent
data: {"agent":"architect","status":"running"}

event: agent
data: {"agent":"explainer","status":"running"}

event: token
data: {"text":"Every todo endpoint "}

event: token
data: {"text":"is wrapped in "}

event: token
data: {"text":"the login_required decorator "}

event: token
data: {"text":"[app/auth.py:12-25]. It reads "}

...

event: final
data: {"citations":[{"file":"app/auth.py","start_line":12,"end_line":25,"why":"..."}, ...],"confidence":0.86,"not_found":false,"provider":"groq","model":"llama-3.3-70b-versatile","agent_trace":[...]}

event: done
data: {}
```

**Parse citation markers on the concatenated text, not on single tokens.**
A real LLM can split a marker like `[app/auth.py:12-25]` across two tokens.
Marker regex: `\[([^\[\]:]+):(\d+)-(\d+)\]`.

Citations are verified after the last token, so:

- **Only link markers that appear in `final.citations`.** The streamed text
  may still contain a marker the backend dropped (the `/ask` answer has them
  removed).
- **If `final.not_found` is true, show "No relevant code found for this
  question"** in place of the streamed text. When nothing relevant is found
  before the answer starts, the stream sends exactly that sentence as the
  only `token`.

### POST /api/repos/{repo_id}/review

Send **either** a unified diff **or** two branch names:

```json
{"diff_text": "--- a/app/routes.py\n+++ b/app/routes.py\n@@ ... @@\n+..."}
```
```json
{"base_branch": "main", "head_branch": "feature/search"}
```

Sending both, or only one branch, returns `422 VALIDATION_ERROR`.

Response:

```json
{
  "summary": "The diff adds GET /api/todos/search in app/routes.py. It is protected by login_required, but it builds SQL with an f-string (SQL injection), returns an unbounded list, and has no test. 1 critical, 2 medium, 1 low.",
  "findings": [
    {
      "id": "F1",
      "category": "security",
      "severity": "critical",
      "file": "app/routes.py",
      "line": 52,
      "title": "SQL query built with an f-string",
      "explanation": "The query interpolates the 'q' query parameter and g.user directly into the SQL string. ...",
      "suggested_fix": "Use placeholders: db.execute(\"SELECT * FROM todos WHERE owner = ? AND title LIKE ?\", (g.user, f\"%{q}%\"))",
      "source": "bandit",
      "confidence": 0.95
    }
  ],
  "agent_trace": [
    {"agent": "architect", "step": 1, "action": "map_impact", "summary": "Diff touches app/routes.py only; ...", "ms": 640}
  ]
}
```

| Finding field | Values |
|---|---|
| category | `bug`, `security`, `practice`, `design` |
| severity | `critical`, `high`, `medium`, `low` |
| source | `llm` (code reviewer agent), `ruff`, `bandit`, `rule` (design rule) |
| confidence | 0–1 |
| line | Line in the file **after** the change |

### POST /api/repos/{repo_id}/repair

Start a repair run. Response is `202 Accepted`, and the run continues in the
background.

```json
{"issue": "Deleting a todo that does not exist returns 500 instead of 404",
 "test_command": "pytest tests/test_routes.py"}
```

`issue`: 1–4000 chars. `test_command?` is optional; the default is the
repo's test suite (`python -m pytest -q`). It must run pytest (`pytest ...` or
`python -m pytest ...`); anything else is `422 VALIDATION_ERROR`.

Real mode (`MOCK_MODE=false`):

- The repo must be indexed (`ready`) and be the root of a local git
  repository, otherwise `409 INVALID_STATE`.
- Only one repair run per repo at a time. Starting another while a run is
  still active (including one in `AWAITING_APPROVAL`) is `409 INVALID_STATE`
  with `details: {"repo_id", "run_id"}` (the active run).
- Tests run in Docker (no network, CPU/memory limits) when Docker is
  available; otherwise as a plain subprocess, and the run gets a `note`
  event saying the sandbox is weaker.
- The patch is written in a git worktree on branch `codexray/fix-<run_id>`.
  The user's checked-out branch is never changed.
- If no test fails at baseline (the repo has no tests, or they all pass), the
  run goes through `REPRODUCING`: the Test writer agent writes one test file,
  `test_codexray_repro_<run_id>.py` at the repo root. It is accepted only if it
  **fails with an assertion** on the unpatched code (not an import or
  collection error, not a pass), with one retry. The accepted test is
  committed on the fix branch and frozen: every attempt must make it pass
  without changing it, and an approved repair's branch includes it. If no
  valid test can be written, the run ends `FAILED`. Tests run with CodeXray's
  own Python packages, not the repo's `requirements.txt`, so code that imports
  a package CodeXray does not have cannot be tested.
- The Reviewer is required: if no reviewer model answers (after one retry,
  which waits for the first cooldown to end, at most 60 s), the run ends
  `FAILED` instead of reaching `AWAITING_APPROVAL`. Its verdict stays advisory.

```json
{"run_id": "run_8c1d2e3f"}
```

Then either poll `GET /api/repairs/{run_id}` or open the events stream.

### GET /api/repairs/{run_id}

The run right now. In mock mode, after ~20 s:

```json
{
  "state": "AWAITING_APPROVAL",
  "attempt": 2,
  "max_attempts": 3,
  "diff": "--- a/app/routes.py\n+++ b/app/routes.py\n@@ -38,6 +38,8 @@ def delete_todo(todo_id):\n     row = db.execute(\n         \"SELECT * FROM todos WHERE id = ? AND owner = ?\", (todo_id, g.user)\n     ).fetchone()\n+    if row is None:\n+        abort(404, description=\"todo not found\")\n     todo = Todo.from_row(row)\n     db.execute(\"DELETE FROM todos WHERE id = ?\", (todo.id,))\n     db.commit()\n",
  "eval": {
    "checks": [
      {"name": "target_test_passes", "passed": true, "detail": "test_delete_missing_todo_returns_404 now passes."},
      {"name": "no_regressions", "passed": true, "detail": "All tests that passed at baseline still pass (1/1)."},
      {"name": "no_test_files_changed", "passed": true, "detail": "The patch changes only app/routes.py."},
      {"name": "patch_size", "passed": true, "detail": "2 lines added, 0 removed (limit 200)."},
      {"name": "lint_clean", "passed": true, "detail": "ruff reports no new issues in changed files."}
    ]
  },
  "reviewer_notes": "The fix handles the missing row at the right place and also covers todos owned by other users, which now return 404 instead of 500. ...",
  "root_cause": "delete_todo (app/routes.py:36-44) never checks the result of fetchone(). When the todo does not exist (or belongs to another user) row is None, Todo.from_row(None) raises TypeError, and Flask returns 500 instead of 404.",
  "events": [
    {"ts": "2026-10-27T10:17:04.972291Z", "state": "CREATED", "attempt": 1, "agent": "coordinator", "kind": "state", "message": "Repair run created.", "data": {"issue": "Deleting a todo that does not exist returns 500 instead of 404"}},
    "... one entry per step ...",
    {"ts": "2026-10-27T10:17:24.472291Z", "state": "AWAITING_APPROVAL", "attempt": 2, "agent": "coordinator", "kind": "state", "message": "Waiting for human approval to merge codexray/repair-2.", "data": {"branch": "codexray/repair-2"}}
  ]
}
```

- `repro_test?` is `{"path", "code"}` when CodeXray wrote a reproduction test
  (see above), else `null`. Show it to the user: the fix is judged against it.
  With a reproduction test, `eval.checks` has one more check,
  `repro_test_unchanged`.
- `diff?`, `eval?`, `reviewer_notes?`, `root_cause?` are `null` until the run
  reaches the step that produces them. After a failed attempt (`CLEANUP`),
  `diff` and `root_cause` go back to `null`, and attempt 2 fills them again.
- `events` holds the full history, in the same format as the SSE stream below.
- Unknown `run_id` → `404 NOT_FOUND`.

### GET /api/repairs/{run_id}/events (SSE)

When you connect, you get every past event at once, then new events as they
happen. The stream ends with `done` when the run reaches
`AWAITING_APPROVAL` or a final state (`MERGED`, `REJECTED`, `FAILED`).

| Event | Data |
|---|---|
| `repair_event` | `{ts, state, attempt, agent?, kind, message, data}` |
| `done` | `{"state": "AWAITING_APPROVAL"}` (the state the run stopped in) |
| `error` | `{"code", "message", "details"}` |

RepairEvent fields:

| Field | Type | Notes |
|---|---|---|
| ts | ISO-8601 UTC datetime | |
| state | Repair state | State of the run when this happened |
| attempt | int | 1..max_attempts |
| agent? | string | `coordinator`, `test_runner`, `architect`, `test_writer`, `debugger`, `repair`, `summarizer`, `eval_gate`, `reviewer` |
| kind | `state`, `agent`, `tests`, `eval`, `note`, `error` | What kind of event |
| message | string | One human-readable line |
| data | object | Extra details. Keys depend on `kind` (e.g. `tests`: `passed`, `failed`, `failing`; `note`: `failure_note`, `branch_deleted`) |

Raw stream (start):

```
event: repair_event
data: {"ts":"2026-10-27T10:17:04.972291Z","state":"CREATED","attempt":1,"agent":"coordinator","kind":"state","message":"Repair run created.","data":{"issue":"Deleting a todo that does not exist returns 500 instead of 404"}}

event: repair_event
data: {"ts":"2026-10-27T10:17:05.972291Z","state":"BASELINE","attempt":1,"agent":"test_runner","kind":"tests","message":"Baseline in sandbox: 1 passed, 1 failed (the failure reproduces the issue).","data":{"passed":1,"failed":1,"failing":["tests/test_routes.py::test_delete_missing_todo_returns_404"]}}

...

event: done
data: {"state":"AWAITING_APPROVAL"}
```

The mock run takes about 20 s and goes through:
`CREATED → BASELINE → PLANNING → BRANCHED → DIAGNOSING → PATCHING → TESTING (fails)
→ CLEANUP → DIAGNOSING (attempt 2) → PATCHING → TESTING (passes) → EVALUATING
→ REVIEWING → AWAITING_APPROVAL`.

### POST /api/repairs/{run_id}/approve and POST /api/repairs/{run_id}/reject

No body. Only allowed while the run is `AWAITING_APPROVAL`; otherwise
`409 INVALID_STATE`. Both return the full run (same shape as
`GET /api/repairs/{run_id}`) with one more event appended:

- approve → `state: "MERGED"` (the patch is merged into a local branch; nothing is pushed)
- reject → `state: "REJECTED"` (the repair branch is deleted)

In real mode, approve commits the patch and creates the local branch
`codexray/approved-<run_id>` (the last event's `data.branch`). The user's main
branch is not changed, and nothing is pushed.

### GET /api/llm/status

```json
{
  "providers": [
    {"name": "groq", "state": "cooldown", "cooldown_until": "2026-10-27T10:15:30Z"},
    {"name": "nvidia", "state": "available", "cooldown_until": null},
    {"name": "deepseek", "state": "no_keys", "cooldown_until": null}
  ],
  "recent_calls": [
    {"lane": "review", "provider": "groq", "model": "llama-3.3-70b-versatile", "ok": false, "switch_reason": null, "latency_ms": 310, "cached": false},
    {"lane": "review", "provider": "nvidia", "model": "meta/llama-3.1-70b-instruct", "ok": true, "switch_reason": "groq rate limited (429); cooling down for 60 s", "latency_ms": 4120, "cached": false}
  ]
}
```

Provider `state`:

| Value | Meaning |
|---|---|
| `available` | Usable |
| `cooldown` | At least one of its models got a 429 and is skipped until `cooldown_until?` (the latest end) |
| `no_keys` | No API key configured in `.env` |
| `disabled` | Keys are configured but every one was rejected as invalid (401); stays until the server restarts |

`recent_calls` holds the last 50 calls, oldest first. Every model the router
tried appears, including failed ones (`ok: false`). `switch_reason?` says why
the router moved away from the previous model, e.g.
`"groq/openai/gpt-oss-120b: rate limited (429), cooling down 60s"`. Cache hits
appear with `cached: true`.

With `MOCK_MODE=true` this endpoint returns the fixture above. With
`MOCK_MODE=false` it returns the live router state, and the server always
answers it, even before the other features are built.

### GET /api/llm/models

Every model the agents can use (all lanes of `routes.yaml`, plus the models of
`EXTRA_PROVIDERS` from `.env`), its state right now, and which one is picked.

```json
{
  "mode": "manual",
  "selected": "groq/openai/gpt-oss-120b",
  "models": [
    {"id": "groq/openai/gpt-oss-120b", "provider": "groq", "model": "openai/gpt-oss-120b",
     "max_context": 131072, "lanes": ["heavy_code", "reviewer"], "state": "available", "cooldown_until": null},
    {"id": "gemini/gemini-3.6-flash", "provider": "gemini", "model": "gemini-3.6-flash",
     "max_context": 1048576, "lanes": ["long_context", "reviewer"], "state": "cooldown",
     "cooldown_until": "2026-10-28T10:00:30Z"}
  ]
}
```

| Field | Notes |
|---|---|
| mode | `auto`: each lane uses its own models in order. After a model fails, the lane stays on the one that answered for 5 minutes before trying its first model again. `manual`: `selected` is tried first by every agent; if it fails, the lane's models answer as in `auto` |
| selected | A model `id`, or `null` in `auto` mode |
| models[].id | `"provider/model"`: the value for `PUT /api/llm/selection` |
| models[].lanes | Lanes that list the model. A picked model is also tried first in the other lanes |
| models[].state | `available`, `cooldown` (429, skipped until `cooldown_until`), `no_keys`, `disabled` (every key rejected), `unavailable` (not in the provider's model list, or refused with 403 this session) |

### PUT /api/llm/selection

Pick the model every agent tries first, or go back to automatic.

```json
{"model": "groq/openai/gpt-oss-120b"}
```

`{"model": null}` = automatic. Returns the same body as `GET /api/llm/models`.
The choice is saved in `DATA_DIR` and survives restarts. While a model is
picked, answers cached from other models are not reused, so the picked model
answers (except in `DEMO_MODE`, which only replays the cache).

The Reviewer still never uses a model that wrote the patch: if the picked model
wrote it, the review comes from the next model in the reviewer lane.

| Status | Code | When |
|---|---|---|
| 422 | `VALIDATION_ERROR` | `model` is not a model `id` from `GET /api/llm/models` (`details.known` lists them) |

### GET /api/embeddings

Which provider makes the vectors for meaning-based search. There are two,
Gemini and NVIDIA; one is used at a time. The server never switches between
them by itself: if the selected one fails, search uses BM25 only.

```json
{
  "enabled": true,
  "selected": "nvidia",
  "providers": [
    {"id": "gemini", "label": "Gemini", "model": "gemini-embedding-2", "available": true},
    {"id": "nvidia", "label": "NVIDIA", "model": "nvidia/nemotron-3.5-embed-1b", "available": true}
  ],
  "adding_vectors": ["flask-todo-1a2b3c4d"]
}
```

| Field | Notes |
|---|---|
| enabled | `false` when `EMBEDDINGS=false`: BM25 search only, `selected` has no effect |
| providers[].available | `false` = no API key for it in `.env` (`GEMINI_API_KEYS` / `NVIDIA_API_KEYS`) |
| adding_vectors | Repos being embedded with the selected provider right now. They answer with BM25 until it is done |

### PUT /api/embeddings/selection

Switch the embedding provider.

```json
{"provider": "nvidia"}
```

Returns the same body as `GET /api/embeddings`. The choice is saved in
`DATA_DIR` and survives restarts (`EMBEDDING_PROVIDER` in `.env` is the
default). Each provider's vectors are stored separately per repo, so
switching back is instant. Ready repos that have no vectors from the new
provider get them in the background (listed in `adding_vectors`; already
embedded chunks come from the on-disk cache). While a repo is in
`adding_vectors`, `POST /api/repos` for it returns `409 INVALID_STATE`.

| Status | Code | When |
|---|---|---|
| 422 | `VALIDATION_ERROR` | `provider` is not `gemini` or `nvidia` |

---

## Repair states

| State | Meaning |
|---|---|
| `CREATED` | Run accepted |
| `BASELINE` | Running the tests before any change, to confirm the failure |
| `PLANNING` | Architect finds the relevant code |
| `BRANCHED` | Git worktree branch created for the attempt |
| `REPRODUCING` | Only when no test failed at baseline: the Test writer writes a reproduction test, which must fail on the unpatched code |
| `DIAGNOSING` | Debugger looks for the root cause (each attempt starts here) |
| `PATCHING` | Repair agent writes a patch |
| `TESTING` | Tests run in the sandbox |
| `EVALUATING` | Eval gate runs its checklist |
| `REVIEWING` | Reviewer (a different model from the patch author) reviews the patch |
| `AWAITING_APPROVAL` | Waiting for a human to approve or reject |
| `MERGED` | Approved and merged into a local branch (final) |
| `REJECTED` | Rejected by the human (final) |
| `FAILED` | Gave up after `max_attempts`, or could not start: no valid reproduction test could be written, the tests could not run, the Reviewer was unavailable, the run's budget ran out, or an error (final). The last `note` or `error` event's `data.reason` says why |
| `CLEANUP` | An attempt failed: failure note written, branch deleted; next is `DIAGNOSING` with `attempt + 1` |

---

## Reading SSE from the browser

`EventSource` only supports GET, so:

- **Repair events** (GET): use `EventSource`.

  ```js
  const es = new EventSource(`${API}/api/repairs/${runId}/events`);
  es.addEventListener("repair_event", (e) => addEvent(JSON.parse(e.data)));
  es.addEventListener("done", () => es.close());
  es.addEventListener("error", (e) => { if (e.data) showError(JSON.parse(e.data)); es.close(); });
  ```

  If you don't close on `done`, the browser reconnects and the full history is
  replayed. That's harmless, but close anyway.

- **Ask stream** (POST): use `fetch` and read the body stream. Split on blank
  lines (`\n\n`). Each block has an `event: <name>` line and a `data: <json>` line.
