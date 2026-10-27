from __future__ import annotations
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "Backend"
FRONTEND = ROOT / "Frontend Main"


def main() -> int:
    # Run the API and web app together; Ctrl+C stops both."
    if os.name == "nt":
        venv_python = BACKEND / ".venv" / "Scripts" / "python.exe"
        npm = shutil.which("npm.cmd") or shutil.which("npm")
    else:
        venv_python = BACKEND / ".venv" / "bin" / "python"
        npm = shutil.which("npm")
    python = str(venv_python) if venv_python.is_file() else sys.executable
    missing: list[str] = []

    if not (BACKEND / "app" / "main.py").is_file():
        missing.append(f"Backend entrypoint is missing: {BACKEND / 'app' / 'main.py'}")
    if not (FRONTEND / "package.json").is_file():
        missing.append(f"Frontend package.json is missing: {FRONTEND / 'package.json'}")
    if npm is None:
        missing.append("Node.js/npm is not installed or is not available on PATH.")
    if not (FRONTEND / "node_modules").is_dir():
        missing.append(f"Frontend dependencies are missing; run `npm install` in {FRONTEND}.")
    if missing:
        print("Cannot start CodeXray:", file=sys.stderr)
        for message in missing:
            print(f"  - {message}", file=sys.stderr)
        return 1
    backend_env = os.environ.copy()
    backend_env.setdefault("FRONTEND_ORIGIN", "http://localhost:5173")
    frontend_env = os.environ.copy()
    frontend_env.setdefault("VITE_API_BASE_URL", "http://localhost:8000")
    commands = [
        (
            "Backend",
            [python, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
            BACKEND,
            backend_env,
        ),
        (
            "Frontend",
            [npm, "run", "dev", "--", "--host", "127.0.0.1"],
            FRONTEND,
            frontend_env,
        ),
    ]
    processes: list[tuple[str, subprocess.Popen[bytes]]] = []
    try:
        for name, command, cwd, env in commands:
            print(f"Starting {name}...", flush=True)
            processes.append((name, subprocess.Popen(command, cwd=cwd, env=env)))
        print("Frontend: http://localhost:5173 | Backend API: http://localhost:8000", flush=True)
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
