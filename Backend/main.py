"""Minimal standard-library API for CodeXray repository agents."""

from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path

from agents.api_caller import LLMError
from agents.coordinator import handle, TASKS
from context_manager import retrieve

ROOT = Path(os.getenv("CODEXRAY_REPO", Path(__file__).resolve().parent.parent)).resolve()

MAX_BODY_BYTES = 1_000_000


class RequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(200, {"status": "ok", "service": "codexray"})
            return
        self._json(404, {"error": "Not found"})

    def do_OPTIONS(self) -> None:
        # Preflight for browser clients on other origins.
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self._cors()
        self.end_headers()

    def do_POST(self) -> None:
        try:
            if self.path != "/agent":
                self._json(404, {"error": "Not found"})
                return
            content_type = self.headers.get("Content-Type", "").split(";")[0].strip().lower()
            if content_type != "application/json":
                self._json(415, {"error": "Content-Type must be application/json"})
                return
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0:
                self._json(400, {"error": "Request body must not be empty"})
                return
            if size > MAX_BODY_BYTES:
                # Drain the body so keep-alive connections stay in sync.
                remaining = size
                while remaining > 0:
                    chunk = self.rfile.read(min(remaining, 65536))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                self._json(413, {"error": f"Request body exceeds {MAX_BODY_BYTES} bytes"})
                return
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                self._json(400, {"error": "Request body must be a JSON object"})
                return
            task = data.get("task", "architecture")
            if task not in TASKS:
                self._json(400, {"error": f"task must be one of: {', '.join(sorted(TASKS))}"})
                return
            prompt = data.get("prompt", "")
            if not isinstance(prompt, str) or not prompt.strip():
                self._json(400, {"error": "prompt must be a non-empty string"})
                return
            budget = data.get("token_budget", 3000)
            if not isinstance(budget, (int, float)) or isinstance(budget, bool) or budget <= 0:
                self._json(400, {"error": "token_budget must be a positive number"})
                return
            context = retrieve(ROOT, prompt, int(budget))
            result = handle(task, prompt, context)
            self._json(200, result)
        except (ValueError, json.JSONDecodeError) as exc:
            self._json(400, {"error": str(exc)})
        except LLMError as exc:
            self._json(502, {"error": str(exc)})
        except Exception:
            # Log details server-side; never leak internal error text to clients.
            self.log_error("unhandled error processing %s", self.path)
            self._json(500, {"error": "Internal server error"})

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}")


if __name__ == "__main__":
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    server = HTTPServer((host, port), RequestHandler)
    print(f"CodeXray API running at http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping CodeXray API")
    finally:
        server.server_close()
