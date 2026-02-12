# Cloud Workspace MVP

Production-grade monorepo MVP for a native-feeling cloud workspace app.

## Monorepo Structure

```text
/backend   Flask REST API + SQLAlchemy + Alembic + JWT + RBAC + file storage
/frontend  React + Vite + TypeScript + Tailwind + shadcn/ui + ReactBits UI
```

## Backend

### Stack
- Flask app factory + Blueprints
- SQLAlchemy ORM + Alembic migrations
- JWT auth (access + refresh)
- RBAC roles/permissions
- Local filesystem storage (S3-ready abstraction)
- Audit logging + login rate limit

### Quick Start

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

# Apply migrations
flask --app wsgi:app db upgrade

# Seed initial admin user (reads ADMIN_USERNAME / ADMIN_PASSWORD from .env)
python seed.py

# Run server
flask --app wsgi:app run --port 5000
```

### Backend Tests

```bash
cd backend
source .venv/bin/activate
pytest -q
```

## Frontend

### Stack
- React + Vite + TypeScript strict mode
- Tailwind CSS + shadcn/ui style primitives
- React Query + Axios typed client
- ReactBits components: Dock, GlassSurface, GlassIcons, GradualBlur, MagicBento, LightPillar

### Quick Start

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

App runs on `http://localhost:5173` and talks to backend `http://localhost:5000` by default.

## Default RBAC Model

- Roles: `admin`, `user`
- Permissions:
  - `FILE_READ`
  - `FILE_WRITE`
  - `FILE_DELETE`
  - `USER_MANAGE`
  - `SERVER_SETTINGS`

Users always manage their own files. Shared-access hooks are present and stubbed for extension.

## Key Features Implemented

- Auth: login, me, refresh, register (admin-only unless enabled)
- Files: tree/list, create folder, upload, download, rename/move, recursive delete, recents, search
- Admin: settings GET/PUT, user CRUD, role assignment
- Quotas: per-user bytes limit + bytes used updates on upload/delete
- Security: safe file naming, traversal protection, random internal file paths, CORS origin control, login rate limiting
- Audit logs for critical actions
- Liquid-glass frontend with dock navigation and quality toggles for heavy effects
