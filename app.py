#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse


ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"
FRONTEND_DIR = ROOT_DIR / "frontend"
RUNTIME_DIR = ROOT_DIR / ".runtime"
BACKEND_VENV_DIR = RUNTIME_DIR / "backend-venv"
MANAGED_ONLYOFFICE_CONTAINER = "cloud-onlyoffice"
MANAGED_ONLYOFFICE_PORT = "8081"
MANAGED_ONLYOFFICE_JWT_SECRET = "cloud-onlyoffice-jwt-secret-at-least-32-bytes"


def run_checked(cmd: list[str], cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    print(f"[setup] {' '.join(cmd)}")
    subprocess.run(cmd, cwd=cwd, env=env, check=True)


def run_capture(
    cmd: list[str],
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def command_exists(command: str) -> bool:
    return shutil.which(command) is not None


def npm_command() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


def backend_python_executable() -> Path:
    if os.name == "nt":
        return BACKEND_VENV_DIR / "Scripts" / "python.exe"
    return BACKEND_VENV_DIR / "bin" / "python"


def ensure_backend_runtime() -> Path:
    python_path = backend_python_executable()
    if python_path.exists():
        return python_path

    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    run_checked([sys.executable, "-m", "venv", str(BACKEND_VENV_DIR)])
    if not python_path.exists():
        raise RuntimeError("Failed to create backend runtime environment.")
    return python_path


def backend_dependencies_installed(python_executable: Path) -> bool:
    check_cmd = [
        str(python_executable),
        "-c",
        "import flask, flask_sqlalchemy, flask_migrate, flask_jwt_extended, flask_cors, dotenv, argon2",
    ]
    return subprocess.run(check_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def ensure_backend_dependencies(python_executable: Path, auto_install: bool) -> None:
    if backend_dependencies_installed(python_executable):
        return

    if not auto_install:
        raise RuntimeError("Backend dependencies are missing. Run: pip install -r backend/requirements.txt")

    run_checked([str(python_executable), "-m", "pip", "install", "-r", "requirements.txt"], cwd=BACKEND_DIR)


def ensure_frontend_dependencies(auto_install: bool) -> None:
    npm = npm_command()
    if not command_exists(npm):
        raise RuntimeError("npm is not installed or not in PATH.")

    node_modules = FRONTEND_DIR / "node_modules"
    if node_modules.exists():
        return

    if not auto_install:
        raise RuntimeError("Frontend dependencies are missing. Run: npm install (in frontend/)")

    run_checked([npm, "install"], cwd=FRONTEND_DIR)


def seed_admin(python_executable: Path, username: str, password: str) -> None:
    env = os.environ.copy()
    env["ADMIN_USERNAME"] = username
    env["ADMIN_PASSWORD"] = password
    run_checked([str(python_executable), "seed.py"], cwd=BACKEND_DIR, env=env)


def wait_for_http(url: str, timeout_seconds: int = 30) -> None:
    start = time.time()
    while time.time() - start < timeout_seconds:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if 200 <= response.status < 500:
                    return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.4)
    raise RuntimeError(f"Timed out waiting for {url}")


def onlyoffice_script_reachable(base_url: str, timeout_seconds: float = 2.5) -> bool:
    script_url = f"{base_url.rstrip('/')}/web-apps/apps/api/documents/api.js"
    request = urllib.request.Request(script_url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            if response.status < 200 or response.status >= 300:
                return False
            content_type = (response.headers.get("Content-Type") or "").lower()
            if "javascript" not in content_type and "application/x-javascript" not in content_type:
                return False
            return True
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def docker_container_exists(container_name: str) -> bool:
    proc = run_capture(["docker", "ps", "-a", "--filter", f"name=^/{container_name}$", "--format", "{{.ID}}"])
    return proc.returncode == 0 and bool(proc.stdout.strip())


def docker_container_running(container_name: str) -> bool:
    proc = run_capture(["docker", "ps", "--filter", f"name=^/{container_name}$", "--format", "{{.ID}}"])
    return proc.returncode == 0 and bool(proc.stdout.strip())


def docker_container_host_port(container_name: str) -> str | None:
    proc = run_capture(["docker", "port", container_name, "80/tcp"])
    if proc.returncode != 0:
        return None

    for line in proc.stdout.splitlines():
        match = re.search(r":(\d+)$", line.strip())
        if match:
            return match.group(1)
    return None


def docker_container_name_for_host_port(host_port: str) -> str | None:
    proc = run_capture(["docker", "ps", "--format", "{{.Names}}\t{{.Ports}}"])
    if proc.returncode != 0:
        return None

    marker = f":{host_port}->"
    for line in proc.stdout.splitlines():
        if marker not in line:
            continue
        name, _, _ports = line.partition("\t")
        name = name.strip()
        if name:
            return name
    return None


def docker_container_env(container_name: str, key: str) -> str | None:
    proc = run_capture(
        [
            "docker",
            "inspect",
            "--format",
            "{{range .Config.Env}}{{println .}}{{end}}",
            container_name,
        ]
    )
    if proc.returncode != 0:
        return None

    prefix = f"{key}="
    for line in proc.stdout.splitlines():
        if line.startswith(prefix):
            return line[len(prefix) :]
    return None


def docker_onlyoffice_local_secret(container_name: str) -> str | None:
    proc = run_capture(
        [
            "docker",
            "exec",
            container_name,
            "sh",
            "-lc",
            "cat /etc/onlyoffice/documentserver/local.json",
        ]
    )
    if proc.returncode != 0 or not proc.stdout.strip():
        return None

    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None

    secret = (
        payload.get("services", {})
        .get("CoAuthoring", {})
        .get("secret", {})
        .get("browser", {})
        .get("string")
    )
    if isinstance(secret, str) and secret.strip():
        return secret.strip()
    return None


def create_managed_onlyoffice_container(container_name: str) -> bool:
    create = run_capture(
        [
            "docker",
            "run",
            "-d",
            "--name",
            container_name,
            "-p",
            f"{MANAGED_ONLYOFFICE_PORT}:80",
            "-e",
            "JWT_ENABLED=true",
            "-e",
            f"JWT_SECRET={MANAGED_ONLYOFFICE_JWT_SECRET}",
            "onlyoffice/documentserver",
        ]
    )
    if create.returncode != 0:
        print(f"[warn] Could not start OnlyOffice container: {create.stderr.strip() or create.stdout.strip()}")
        return False
    return True


def ensure_onlyoffice_container() -> tuple[str | None, str | None]:
    if not command_exists("docker"):
        return None, None

    container_name = MANAGED_ONLYOFFICE_CONTAINER
    host_port = docker_container_host_port(container_name)
    jwt_secret: str | None = None
    jwt_enabled = True

    if not docker_container_exists(container_name):
        print("[setup] Starting local OnlyOffice container (cloud-onlyoffice)...")
        if not create_managed_onlyoffice_container(container_name):
            return None, None
        host_port = MANAGED_ONLYOFFICE_PORT
        jwt_secret = MANAGED_ONLYOFFICE_JWT_SECRET
    else:
        if not docker_container_running(container_name):
            print("[setup] Starting existing OnlyOffice container (cloud-onlyoffice)...")
            start = run_capture(["docker", "start", container_name])
            if start.returncode != 0:
                print(f"[warn] Could not start existing OnlyOffice container: {start.stderr.strip() or start.stdout.strip()}")
                return None, None
        if not host_port:
            host_port = MANAGED_ONLYOFFICE_PORT

        jwt_enabled_raw = (docker_container_env(container_name, "JWT_ENABLED") or "").strip().lower()
        if jwt_enabled_raw in {"0", "false", "no", "off"}:
            jwt_enabled = False

        jwt_secret = docker_container_env(container_name, "JWT_SECRET")
        if jwt_enabled and not jwt_secret:
            print("[setup] Recreating existing cloud-onlyoffice container with managed JWT secret...")
            remove = run_capture(["docker", "rm", "-f", container_name])
            if remove.returncode != 0:
                print(f"[warn] Could not recreate existing OnlyOffice container: {remove.stderr.strip() or remove.stdout.strip()}")
                return None, None
            if not create_managed_onlyoffice_container(container_name):
                return None, None
            host_port = MANAGED_ONLYOFFICE_PORT
            jwt_enabled = True
            jwt_secret = MANAGED_ONLYOFFICE_JWT_SECRET

    candidate_url = f"http://127.0.0.1:{host_port}"
    deadline = time.time() + 120
    while time.time() < deadline:
        if onlyoffice_script_reachable(candidate_url, timeout_seconds=3.0):
            return candidate_url, (jwt_secret if jwt_enabled else None)
        time.sleep(2)

    print(f"[warn] OnlyOffice container is running but script is not reachable at {candidate_url}/web-apps/apps/api/documents/api.js")
    return None, None


def terminate_processes(processes: list[subprocess.Popen[str]]) -> None:
    for process in processes:
        if process.poll() is None:
            process.terminate()

    deadline = time.time() + 6
    for process in processes:
        if process.poll() is None:
            wait_seconds = max(0, deadline - time.time())
            try:
                process.wait(timeout=wait_seconds)
            except subprocess.TimeoutExpired:
                process.kill()


def start_backend(
    python_executable: Path,
    port: int,
    env_overrides: dict[str, str] | None = None,
) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env["FLASK_ENV"] = "production"
    env["FLASK_DEBUG"] = "0"
    env["PYTHONUNBUFFERED"] = "1"
    env.setdefault("FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    env.setdefault("ONLYOFFICE_PUBLIC_BACKEND_URL", f"http://127.0.0.1:{port}")
    if env_overrides:
        env.update(env_overrides)
    return subprocess.Popen(
        [
            str(python_executable),
            "-m",
            "flask",
            "--app",
            "wsgi:app",
            "run",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        cwd=BACKEND_DIR,
        env=env,
    )


def start_frontend(port: int, backend_port: int) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env["VITE_API_BASE_URL"] = f"http://127.0.0.1:{backend_port}"
    env["FORCE_COLOR"] = "1"
    npm = npm_command()
    return subprocess.Popen(
        [
            npm,
            "run",
            "dev",
            "--",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--strictPort",
        ],
        cwd=FRONTEND_DIR,
        env=env,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start Cloud Workspace (backend + frontend).")
    parser.add_argument("--backend-port", type=int, default=5000)
    parser.add_argument("--frontend-port", type=int, default=5173)
    parser.add_argument("--admin-user", default="admin")
    parser.add_argument("--admin-password", default="admin123")
    parser.add_argument("--backend-only", action="store_true")
    parser.add_argument("--no-install", action="store_true", help="Do not auto-install missing dependencies.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not command_exists(sys.executable):
        raise RuntimeError("Python interpreter is not available.")

    if not BACKEND_DIR.exists() or not FRONTEND_DIR.exists():
        raise RuntimeError("Expected /backend and /frontend directories in the project root.")

    auto_install = not args.no_install
    backend_python = ensure_backend_runtime()
    ensure_backend_dependencies(backend_python, auto_install=auto_install)
    if not args.backend_only:
        ensure_frontend_dependencies(auto_install=auto_install)

    backend_env_overrides: dict[str, str] = {}
    onlyoffice_requested = os.environ.get("ONLYOFFICE_ENABLED", "true").strip().lower() not in {"0", "false", "no", "off"}
    chosen_onlyoffice_url: str | None = None
    chosen_onlyoffice_jwt_secret = (os.environ.get("ONLYOFFICE_JWT_SECRET") or "").strip() or None
    if onlyoffice_requested:
        explicit_url = os.environ.get("ONLYOFFICE_DOCUMENT_SERVER_URL")
        if explicit_url:
            if onlyoffice_script_reachable(explicit_url):
                chosen_onlyoffice_url = explicit_url.rstrip("/")
            else:
                print(f"[warn] OnlyOffice script not reachable at {explicit_url.rstrip('/')}/web-apps/apps/api/documents/api.js")

        if not chosen_onlyoffice_url:
            candidates = ["http://127.0.0.1:8080", "http://127.0.0.1:8081"]
            for candidate in candidates:
                if onlyoffice_script_reachable(candidate):
                    chosen_onlyoffice_url = candidate
                    break

            if not chosen_onlyoffice_url:
                managed_url, managed_secret = ensure_onlyoffice_container()
                chosen_onlyoffice_url = managed_url
                if managed_secret and not chosen_onlyoffice_jwt_secret:
                    chosen_onlyoffice_jwt_secret = managed_secret

        if chosen_onlyoffice_url:
            if not chosen_onlyoffice_jwt_secret and docker_container_exists(MANAGED_ONLYOFFICE_CONTAINER):
                chosen_port = str(urlparse(chosen_onlyoffice_url).port or "")
                managed_port = docker_container_host_port(MANAGED_ONLYOFFICE_CONTAINER) or ""
                if chosen_port and chosen_port == managed_port:
                    managed_secret = docker_container_env(MANAGED_ONLYOFFICE_CONTAINER, "JWT_SECRET")
                    if not managed_secret:
                        managed_secret = docker_onlyoffice_local_secret(MANAGED_ONLYOFFICE_CONTAINER)
                    if managed_secret:
                        chosen_onlyoffice_jwt_secret = managed_secret

            backend_env_overrides["ONLYOFFICE_DOCUMENT_SERVER_URL"] = chosen_onlyoffice_url
            backend_env_overrides["ONLYOFFICE_ENABLED"] = "true"
            if chosen_onlyoffice_jwt_secret:
                backend_env_overrides["ONLYOFFICE_JWT_SECRET"] = chosen_onlyoffice_jwt_secret
            explicit_public_backend = (os.environ.get("ONLYOFFICE_PUBLIC_BACKEND_URL") or "").strip()
            if explicit_public_backend:
                backend_env_overrides["ONLYOFFICE_PUBLIC_BACKEND_URL"] = explicit_public_backend.rstrip("/")
            else:
                parsed_doc_server = urlparse(chosen_onlyoffice_url)
                doc_server_host = (parsed_doc_server.hostname or "").strip().lower()
                doc_server_port = str(parsed_doc_server.port or "")
                if doc_server_host in {"127.0.0.1", "localhost"} and doc_server_port and command_exists("docker"):
                    container_name = docker_container_name_for_host_port(doc_server_port)
                    if container_name:
                        backend_env_overrides["ONLYOFFICE_PUBLIC_BACKEND_URL"] = (
                            f"http://host.docker.internal:{args.backend_port}"
                        )
                        print(
                            f"[setup] OnlyOffice container '{container_name}' detected on port {doc_server_port}; "
                            f"using {backend_env_overrides['ONLYOFFICE_PUBLIC_BACKEND_URL']} for Office callbacks."
                        )
        else:
            backend_env_overrides["ONLYOFFICE_ENABLED"] = "false"
            print("[warn] OnlyOffice disabled: no reachable Document Server found on http://127.0.0.1:8080 or :8081")
            print("[hint] Start one with: docker run -d --name onlyoffice -p 8081:80 onlyoffice/documentserver")

    seed_admin(backend_python, username=args.admin_user, password=args.admin_password)

    processes: list[subprocess.Popen[str]] = []
    backend_process: subprocess.Popen[str] | None = None
    frontend_process: subprocess.Popen[str] | None = None

    try:
        backend_process = start_backend(backend_python, port=args.backend_port, env_overrides=backend_env_overrides)
        processes.append(backend_process)

        wait_for_http(f"http://127.0.0.1:{args.backend_port}/health", timeout_seconds=35)

        if not args.backend_only:
            frontend_process = start_frontend(port=args.frontend_port, backend_port=args.backend_port)
            processes.append(frontend_process)

        print("")
        print("Cloud Workspace is running")
        print(f"Backend:  http://127.0.0.1:{args.backend_port}")
        if not args.backend_only:
            print(f"Frontend: http://127.0.0.1:{args.frontend_port}")
        onlyoffice_enabled = backend_env_overrides.get("ONLYOFFICE_ENABLED", os.environ.get("ONLYOFFICE_ENABLED", "true")).strip().lower() not in {
            "0",
            "false",
            "no",
            "off",
        }
        if onlyoffice_enabled:
            onlyoffice_url = backend_env_overrides.get("ONLYOFFICE_DOCUMENT_SERVER_URL") or os.environ.get(
                "ONLYOFFICE_DOCUMENT_SERVER_URL",
                "http://127.0.0.1:8080",
            )
            print(f"Office:   {onlyoffice_url}")
        else:
            print("Office:   disabled (Document Server not reachable)")
        print(f"Admin:    {args.admin_user} / {args.admin_password}")
        print("Stop with Ctrl+C")
        print("")

        while True:
            if backend_process and backend_process.poll() is not None:
                return backend_process.returncode or 1
            if frontend_process and frontend_process.poll() is not None:
                return frontend_process.returncode or 1
            time.sleep(1)

    except KeyboardInterrupt:
        print("\nStopping Cloud Workspace...")
        return 0
    finally:
        terminate_processes(processes)


if __name__ == "__main__":
    signal.signal(signal.SIGINT, signal.default_int_handler)
    raise SystemExit(main())
