"""Minimal standard-library API for CodeXray repository agents."""

from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path

from agents.api_caller import LLMError
from agents.coordinator import handle
from context_manager import retrieve

ROOT = Path(os.getenv("CODEXRAY_REPO", Path(__file__).resolve().parent.parent)).resolve()


class RequestHandler(BaseHTTPRequestHandler):
    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(200, {"status": "ok", "service": "codexray"})
            return
        self.send_error(404, "Not found")

    def do_POST(self) -> None:
        if self.path != "/agent":
            self.send_error(404, "Not found")
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size <= 0 or size > 1_000_000:
                self._json(400, {"error": "Request body must be between 1 byte and 1 MB"})
                return
            data = json.loads(self.rfile.read(size))
            task = data.get("task", "architecture")
            prompt = data.get("prompt", "")
            if not isinstance(prompt, str) or not prompt.strip():
                self._json(400, {"error": "prompt must be a non-empty string"})
                return
            context = retrieve(ROOT, prompt, int(data.get("token_budget", 3000)))
            result = handle(task, prompt, context)
            self._json(200, result)
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            self._json(400, {"error": str(exc)})
        except LLMError as exc:
            self._json(502, {"error": str(exc)})
        except Exception as exc:
            self._json(500, {"error": f"Agent request failed: {exc}"})

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}")


if __name__ == "__main__":
    server = HTTPServer((os.getenv("HOST", "127.0.0.1"), int(os.getenv("PORT", "8000"))), RequestHandler)
    print("CodeXray API running at http://localhost:8000")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping CodeXray API")
    finally:
        server.server_close()
