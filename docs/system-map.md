# System Map

Last updated: 2026-02-14

This is the current (as-is) component and data-flow map for `/Users/pond/cloud`.

## Components

- Browser (end-user)
- Frontend UI (`/frontend`, Vite/React)
- Cloud Workspace API (`/backend`, Flask)
- Cloud Workspace DB (`cloud.db`, SQLite by default)
- Cloud Workspace storage (`/storage`, filesystem by default)
- OnlyOffice Document Server (container, optional)
- IDE control plane (`/ide-backend`, Node/Express + WS)
- IDE control plane DB (SQLite, `cloudide.db`)
- IDE runner (`/runner`, Node/Express + WS)
- Docker Engine (runner talks to the host docker socket)
- External integrations:
  - InventoryPro (HTTP API + SSO ticket flow)
  - IMAP/SMTP servers (mail accounts)

## Data Flows (High Level)

```mermaid
flowchart LR
  subgraph Internet["Public Internet / User Devices"]
    B["Browser"]
  end

  subgraph AppNet["App Network (Reverse proxy or local dev)"]
    FE["Frontend UI (Vite/React)"]
    API["Cloud Workspace API (Flask)"]
    OO["OnlyOffice Document Server (optional)"]
  end

  subgraph Data["Data Plane"]
    DB["SQLite DB (cloud.db)"]
    FS["Filesystem Storage (/storage)"]
  end

  subgraph IdeNet["IDE Network (Docker Compose)"]
    IDE["IDE Backend (Express + WS)"]
    IDEDB["IDE SQLite (cloudide.db)"]
    RUN["Runner (Express + WS)"]
    DOCKER["Docker Engine / docker.sock"]
    WV["Workspace Volume (/workspaces)"]
  end

  subgraph External["External Services"]
    INV["InventoryPro (HTTP)"]
    MAIL["IMAP/SMTP Servers"]
  end

  B --> FE
  FE --> API

  %% OnlyOffice: browser loads docs api from OO, OO calls back to API
  B --> OO
  OO --> API
  FE --> OO

  API --> DB
  API --> FS

  API --> INV
  API --> MAIL

  %% IDE: browser connects to IDE backend, IDE backend talks to runner and its own DB
  B --> IDE
  IDE --> IDEDB
  IDE --> RUN
  RUN --> DOCKER
  RUN --> WV
  IDE --> WV
```

## Trust Boundaries / Threat Surfaces (As-Is)

Public boundary
- Browser to frontend and backend APIs (HTTP).
- Browser to IDE backend (HTTP + WebSocket).
- Browser to OnlyOffice (HTTP).

Internal boundary
- Backend API to DB and filesystem storage (local).
- IDE backend to runner (internal compose network).
- Runner to docker socket (high-privilege boundary).

Secrets / credentials (current)
- Cloud backend:
  - `JWT_SECRET_KEY` for access/refresh token signing.
  - `ONLYOFFICE_TOKEN_SECRET` and related OnlyOffice JWT config.
  - `MAIL_CREDENTIALS_KEY` for mail credential encryption.
  - `INVENTORY_PRO_SHARED_SECRET` for integration auth.
- IDE backend / runner:
  - `JWT_SECRET` (IDE JWT)
  - `APP_ENCRYPTION_KEY`
  - `RUNNER_SHARED_SECRET` (runner request authentication)

Notes
- Runner has elevated capabilities via Docker socket; it must remain internal-only (no direct exposure).
- Most rate limiting and refresh-token reuse detection are in-memory today; HA deployments will require shared stores.

