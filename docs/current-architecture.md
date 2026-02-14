# Current Architecture (As-Is)

Last updated: 2026-02-14

This document describes the current state of the repo under `/Users/pond/cloud` before the larger platform rebuild.

## Repo Layout

- `/backend`: Cloud Workspace backend API (Python/Flask).
- `/frontend`: Cloud UI (React/Vite) including IDE routes (`/dev/*`).
- `/ide-backend`: Cloud IDE control plane (Node/Express + WebSocket).
- `/runner`: Cloud IDE runner service (Node/Express + WebSocket, controls Docker).
- `/infra`: Dockerfiles + assets for IDE services and workspace image.
- `/docker-compose.yml`: Compose config for IDE services (ide-backend + runner + workspace image).
- `/app.py`: one-command local launcher for backend + frontend + optional IDE services.
- `/cloud.db`: default backend database (SQLite).
- `/storage`: default file blob storage root (filesystem).

## Tech Stack / Build Tools

Backend (`/backend`)
- Python 3.x
- Flask 3.x (`Flask==3.1.0`)
- SQLAlchemy via `Flask-SQLAlchemy`
- DB migrations via `Flask-Migrate` (Alembic) in `/backend/migrations`
- Auth via `Flask-JWT-Extended` (access + refresh JWTs)
- Password hashing via `argon2-cffi`
- Feature flags loaded from `/config/feature-flags.json` (new features default OFF)

Frontend (`/frontend`)
- React 18 + TypeScript
- Vite 6 build/dev server
- TailwindCSS
- Monaco editor + xterm for IDE UX

IDE control plane (`/ide-backend`)
- Node.js (Docker image uses Node 20)
- Express API + `ws` WebSocket server
- SQLite (better-sqlite3), default path `data/cloudide.db`

IDE runner (`/runner`)
- Node.js (Docker image uses `docker:*` CLI image + Node toolchain)
- Express API + `ws` WebSocket server
- Uses Docker socket to start/manage workspace containers
- AuthN uses `x-runner-secret` shared secret header

## Authentication / Authorization (Current)

Cloud backend (`/backend`)
- Local username/password login: `/auth/login`
- Local registration exists but is disabled by default (`ALLOW_REGISTRATION=false`): `/auth/register`
- JWT access token + refresh token: `/auth/login` returns both.
- Refresh endpoint: `/auth/refresh`
  - Refresh reuse detection is in-memory only (`backend/app/common/token_store.py`), so it resets on backend restart.
- InventoryPro SSO exchange (optional): `/auth/inventorypro/exchange`
- RBAC model:
  - Users have roles; roles have permissions (`PermissionCode` enum in `backend/app/models.py`).
  - Backend endpoint guards use `@permission_required(...)`.

App-layer protections (baseline, behind flags)
- CSRF origin/referrer validation for state-changing requests (`security.csrf`)
- Global request rate limiting (IP + user + endpoint class) (`security.rate_limit`)

IDE backend (`/ide-backend`)
- Has its own JWT secret/config for IDE-specific auth and also enforces origin checks for WebSocket upgrades.
- The Cloud UI boots IDE usage from within authenticated Cloud sessions (implementation detail lives in frontend + IDE backend).

## Database (Current)

Cloud backend DB
- Engine: SQLite by default (`sqlite:////Users/pond/cloud/cloud.db`), configurable via `DATABASE_URL`.
- Schema (high-level tables/models):
  - Identity/RBAC: `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, `user_ui_preferences`
  - Files: `file_nodes`
  - Sharing: `share_links`, `internal_shares`
  - Settings: `app_settings`
  - Audit: `audit_logs`
  - Backups/restore metadata: `backup_jobs`, `restore_points`
  - Quotas/usage: `resource_quotas`
  - Monitoring snapshots: `system_metric_snapshots`

IDE backend DB
- Engine: SQLite (better-sqlite3), default `ide-backend/data/cloudide.db` (container uses `/data/cloudide.db`).

## Storage (Current)

Cloud file blobs
- Storage root: filesystem directory `STORAGE_ROOT` (default: `/Users/pond/cloud/storage`).
- Upload writes a generated `{bucket}/{uuid}{ext}` relative path; metadata stored in `file_nodes.storage_path`.
- No file versioning, retention, or immutable backups implemented at the file layer yet (metadata includes backup job concepts, but versioning is not attached to file writes).

IDE workspace data
- Workspace metadata and on-disk artifacts live under `WORKSPACES_ROOT` (container default: `/workspaces`) and a Docker named volume `cloudide-workspaces`.

## Search / Index (Current)

- File search endpoint (`/files/search`) performs a SQL `ilike` on file/folder names only.
- No global full-text indexing engine is wired in.

## Real-Time (Current)

- IDE control plane (`/ide-backend`) accepts HTTP upgrades and uses WebSockets (`ws`) for realtime IDE interactions.
- IDE runner (`/runner`) also exposes WebSockets (used for interactive terminals/streams).
- Cloud backend does not currently expose WebSocket/SSE endpoints.

## Deployment / Runtime (Current)

Local dev (recommended)
- `python3 app.py`:
  - creates a managed backend venv under `/.runtime/backend-venv`
  - installs backend and frontend dependencies (if missing)
  - seeds an admin user (`admin` / `admin123`)
  - starts Flask on `http://127.0.0.1:5001`
  - starts Vite frontend on `http://127.0.0.1:5173`
  - optionally starts IDE services via Docker Compose (`/docker-compose.yml`)

IDE services (Docker Compose)
- `ide-backend`: exposed on host `18080` (container port 8080)
- `runner`: internal service (container port 8081)
- `workspace-image`: build-only base image

OnlyOffice
- Cloud Workspace integrates with OnlyOffice Document Server.
- `app.py` can manage an OnlyOffice container for local use.

## Existing Features (Current)

Cloud Workspace (backend + frontend)
- File manager: folders/files, upload/download, rename/move/delete, recents
- Sharing:
  - internal shares (user-to-user)
  - public share links (token + optional expiry)
- OnlyOffice document editing (Word/Excel/PowerPoint)
- Media page (basic gallery/player experience driven by file types)
- Global search (by filename)
- Admin:
  - user management (create/update/delete, role assignment)
  - role & permission management
  - server settings (registration, quotas, InventoryPro integration)
- Monitoring dashboard:
  - host metrics snapshots (CPU/mem/disk/net/load)
  - Docker provider status (best-effort)
  - audit logs list + CSV export
  - backups/restore points overview (metadata-level)
  - quotas overview
- Mail client (IMAP/SMTP accounts stored encrypted at rest in DB)
- InventoryPro integration (optional): user sync + SSO ticket exchange + dock entry

Cloud IDE (frontend + ide-backend + runner)
- Workspace list and IDE experience under `/dev/*`
- WebSocket-based live interactions (terminal/preview)
