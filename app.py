from __future__ import annotations
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "Backend"
FRONTEND = ROOT / "Frontend Main"
# The backend is a package rooted at Backend/, while this launcher lives at the
# repository root. Make its import path explicit for both local and hosted runs.
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def available_port(start: int) -> int:
    """Return the first localhost port at or above start that can be bound."""
    for port in range(start, start + 100):
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise RuntimeError(f"No available localhost port found between {start} and {start + 99}.")


def main() -> int:
    # Run the API and web app together; Ctrl+C stops both."
    if os.name == "nt":
        venv_pythons = (
            BACKEND / ".venv" / "Scripts" / "python.exe",
            BACKEND / ".venv313" / "Scripts" / "python.exe",
        )
        npm = shutil.which("npm.cmd") or shutil.which("npm")
    else:
        venv_pythons = (
            BACKEND / ".venv" / "bin" / "python",
            BACKEND / ".venv313" / "bin" / "python",
        )
        npm = shutil.which("npm")
    python = next(
        (
            str(candidate)
            for candidate in venv_pythons
            if candidate.is_file() and (candidate.parent.parent / "pyvenv.cfg").is_file()
        ),
        sys.executable,
    )
    missing: list[str] = []
    production = bool(os.environ.get("RENDER") or os.environ.get("PORT"))

    if not (BACKEND / "app" / "main.py").is_file():
        missing.append(f"Backend entrypoint is missing: {BACKEND / 'app' / 'main.py'}")
    if not production and not (FRONTEND / "package.json").is_file():
        missing.append(f"Frontend package.json is missing: {FRONTEND / 'package.json'}")
    if not production and npm is None:
        missing.append("Node.js/npm is not installed or is not available on PATH.")
    if not production and not (FRONTEND / "node_modules").is_dir():
        missing.append(f"Frontend dependencies are missing; run `npm install` in {FRONTEND}.")
    if missing:
        print("Cannot start CodeXray:", file=sys.stderr)
        for message in missing:
            print(f"  - {message}", file=sys.stderr)
        return 1
    # Render and other production hosts provide PORT and expose one service.
    # In that mode, run only the API; serve the built frontend separately/static.
    if production:
        port = int(os.environ.get("PORT", "8000"))
        # A single Render web service uses its own public URL as the browser
        # origin unless a separately hosted frontend URL was configured.
        if not os.environ.get("FRONTEND_ORIGIN") and os.environ.get("RENDER_EXTERNAL_URL"):
            os.environ["FRONTEND_ORIGIN"] = os.environ["RENDER_EXTERNAL_URL"]
        os.chdir(BACKEND)
        os.execv(python, [python, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", str(port)])

    frontend_port = available_port(5173)
    frontend_origin = f"http://127.0.0.1:{frontend_port}"
    backend_env = os.environ.copy()
    # Keep FastAPI's CORS allowlist aligned with Vite's actual port. Vite otherwise
    # silently advances to 5174/5175 when its default port is already occupied.
    backend_env["FRONTEND_ORIGIN"] = frontend_origin
    frontend_env = os.environ.copy()
    frontend_env.setdefault("VITE_API_BASE_URL", "http://127.0.0.1:8000")
    frontend_env.setdefault("VITE_USE_MOCK", "false")
    commands = [
        (
            "Backend",
            [python, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
            BACKEND,
            backend_env,
        ),
        (
            "Frontend",
            [npm, "run", "dev", "--", "--host", "127.0.0.1", "--port", str(frontend_port), "--strictPort"],
            FRONTEND,
            frontend_env,
        ),
    ]
    processes: list[tuple[str, subprocess.Popen[bytes]]] = []
    try:
        for name, command, cwd, env in commands:
            print(f"Starting {name}...", flush=True)
            processes.append((name, subprocess.Popen(command, cwd=cwd, env=env)))
        print(f"Frontend: {frontend_origin} | Backend API: http://127.0.0.1:8000", flush=True)
        while True:
            for name, process in processes:
                status = process.poll()
                if status is not None:
                    print(f"{name} stopped with exit code {status}.", file=sys.stderr)
                    return status or 1
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\nStopping CodeXray...", flush=True)
        return 0
    finally:
        for _, process in processes:
            if process.poll() is None:
                process.terminate()
        for _, process in processes:
            if process.poll() is None:
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()

if __name__ == "__main__":
    raise SystemExit(main())
