# Cloud Workspace + Cloud IDE

This repository now contains both:
- the original **Cloud Workspace** app (files/folders/shares/admin/OnlyOffice), and
- the new **Cloud IDE** as an additional area inside the same frontend (`/dev/*` routes).

## Structure

```text
/backend       Flask Cloud Workspace API (original app)
/frontend      React app (Cloud UI + integrated IDE routes)
/ide-backend   Node.js control plane for Cloud IDE
/runner        Isolated Docker runner for Cloud IDE workloads
/infra         Dockerfiles and compose config for IDE services
/app.py        One-command launcher for the Cloud app (+ optional IDE services)
```

## One Command (recommended)

```bash
cd /Users/pond/cloud
python3 app.py
```

`app.py` will:
- auto-manage backend Python runtime under `.runtime/`,
- install missing `backend/` and `frontend/` dependencies,
- seed admin user (`admin` / `admin123`),
- start Flask on `http://127.0.0.1:5000`,
- start frontend on `http://127.0.0.1:5173`,
- try to auto-start IDE services (`ide-backend` + `runner`) via Docker Compose.

## URLs

- Cloud app: `http://127.0.0.1:5173/app/files`
- IDE workspace list: `http://127.0.0.1:5173/dev/workspaces`
- IDE API: `http://127.0.0.1:18080`

## InventoryPro Integration

Cloud can now be integrated directly with InventoryPro (same host or external host):

1. Open `Admin -> Server`.
2. Configure `InventoryPro URL`, enable integration, and set a shared secret.
3. Optionally enable:
   - user sync (`/integration/inventorypro/users/sync`)
   - SSO ticket flow (`/integration/inventorypro/sso/ticket` + `/auth/inventorypro/exchange`)
   - `Inventory Pro` item in the Cloud Dock.

The Cloud backend stores an `inventory_pro_user_id` mapping per user so both systems can use a central user lifecycle.

## How To Use Monitoring Dashboard

1. Log in with an admin account.
2. Open `Monitoring` from the bottom Dock (route: `http://127.0.0.1:5173/app/monitoring`).
3. Use tabs for:
   - Overview: host health KPIs + trends
   - Containers: Docker runtime status (degraded message if unavailable)
   - Storage / Network: capacity + interface trends from snapshots
   - Audit Logs: filtered logs + CSV export
   - Backups & Restore: backup jobs, logs modal, restore point records
   - Quotas: storage/runtime/bandwidth limits and current usage
4. Keep `Auto-refresh` enabled for live monitoring, or use `Refresh now` for manual pulls.

You can open the IDE from:
- Dock item `IDE`
- Settings -> `Open Cloud IDE`

No separate IDE login is required anymore: when you are logged into the Cloud app, IDE session bootstrap happens automatically.

## If IDE services are not running

```bash
docker compose up -d workspace-image runner ide-backend
```

## OnlyOffice

Cloud document editing (Word/Excel/PowerPoint) still works as before.
If needed:

```bash
docker rm -f cloud-onlyoffice
python3 app.py
```

## Dev Commands

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Cloud IDE backend + runner tests
```bash
npm run test -w ide-backend
npm run test -w runner
```

### Cloud Flask backend tests
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest -q
```
