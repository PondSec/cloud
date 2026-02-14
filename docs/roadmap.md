# Roadmap / Master Backlog

Last updated: 2026-02-14

Legend
- Status: `TODO` | `IN PROGRESS` | `DONE`
- Priority: `P0` (must) | `P1` (should) | `P2` (nice)

## Phase 0: Repo Inventur (Must Be First)

### CLOUD-0001 (P0) Repo Scan + Current Architecture Doc

- Status: DONE
- Depends on: -
- Acceptance Criteria: `/docs/current-architecture.md` exists and covers stack, auth, DB, storage, search/index, realtime, deployment, existing features.
- Test Plan: run existing unit/integration tests and builds; no regressions.
- Commits: -

### CLOUD-0002 (P0) System Map Doc

- Status: DONE
- Depends on: CLOUD-0001
- Acceptance Criteria: `/docs/system-map.md` exists with components, data flows, and trust boundaries.
- Test Plan: doc-only change; run existing tests/builds.
- Commits: -

### CLOUD-0003 (P0) Project Skeleton Structure

- Status: DONE
- Depends on: -
- Acceptance Criteria: `/docs/decisions/`, `/docs/runbooks/`, `/config/feature-flags.json`, `/scripts/` exist.
- Test Plan: doc/config-only change; run existing tests/builds.
- Commits: -

### CLOUD-0004 (P0) Master Backlog

- Status: DONE
- Depends on: CLOUD-0001, CLOUD-0002, CLOUD-0003
- Acceptance Criteria: `/docs/roadmap.md` contains epics 1..12 with sub-items; each sub-item has ID, priority, deps, AC, and test plan.
- Test Plan: doc-only change; run existing tests/builds.
- Commits: -

## Epic 1: Foundation (P0)

### CLOUD-0101 (P0) 1.1 Security Baseline (Global)

- Status: DONE
- Depends on: CLOUD-0004
- Acceptance Criteria: CSP/HSTS/frame/referrer/permissions headers; secure cookies; CSRF protection; rate limiting; brute force lockout; input validation baseline; OWASP smoke tests prove enforcement.
- Test Plan: unit tests for middleware; integration tests for CSRF/rate-limit; e2e smoke: login + blocked CSRF.
- Commits: -

### CLOUD-0102 (P0) 1.2 Audit Event Bus (Hash-Chained)

- Status: TODO
- Depends on: CLOUD-0101
- Acceptance Criteria: central `audit.emit(...)`; DB `audit_events` with hash-chain fields; admin export JSON/CSV; UI list+filters+export; auth actions emit events; `scripts/verify-audit-chain` exists.
- Test Plan: unit tests for hashing; integration tests for export; script test on fixture DB; e2e: login emits events and export works.
- Commits: -

### CLOUD-0103 (P0) 1.3 Auth Rework (Identity Core)

- Status: TODO
- Depends on: CLOUD-0102
- Acceptance Criteria: local login + generic OIDC with google/microsoft presets; optional SAML adapter behind flag; access+refresh rotation with persistent store + reuse detection; sessions table; UI login + sessions list + logout device/all.
- Test Plan: unit tests for token rotation; integration tests for OIDC callback; e2e: login/logout/refresh rotation/session revoke.
- Commits: -

### CLOUD-0104 (P0) 1.4 MFA + Passkeys

- Status: TODO
- Depends on: CLOUD-0103
- Acceptance Criteria: WebAuthn register/login; TOTP enroll/verify; recovery codes hashed and one-time; MFA required for sensitive actions (policy); UI security settings.
- Test Plan: unit tests for TOTP and recovery codes; mocked WebAuthn integration tests; e2e: enable MFA then perform sensitive action requires MFA.
- Commits: -

### CLOUD-0105 (P0) 1.5 Just-in-Time Admin (Elevation)

- Status: TODO
- Depends on: CLOUD-0104
- Acceptance Criteria: time-limited privilege elevation with re-auth (MFA); admin actions require elevation when enabled; auto-revoke; UI button “Admin fuer 15 Min aktivieren”.
- Test Plan: integration tests for elevation gates; e2e: enable policy then verify admin pages require elevation.
- Commits: -

## Epic 2: Backup / Restore / Versioning (P0/P1)

### CLOUD-0201 (P0) 2.1 Storage Abstraction

- Status: TODO
- Depends on: CLOUD-0101
- Acceptance Criteria: storage interface for put/get/list/move/delete + version ops; filesystem impl; optional S3 adapter behind flag; all file operations go through abstraction.
- Test Plan: unit tests for interface; integration tests for filesystem impl; contract tests for S3 adapter (mock).
- Commits: -

### CLOUD-0202 (P0) 2.2 File Versioning

- Status: TODO
- Depends on: CLOUD-0201
- Acceptance Criteria: upload/edit/move/delete create versions; retention policy (last N + daily snapshots); UI versions list + text diff where possible; restore reverts correctly.
- Test Plan: integration tests for version creation/restore; e2e: upload v1, edit v2, restore to v1.
- Commits: -

### CLOUD-0203 (P1) 2.3 DB Snapshots + PITR Hooks

- Status: TODO
- Depends on: CLOUD-0201
- Acceptance Criteria: snapshot job; PITR strategy implemented or provider-documented with hooks; UI restore points list (admin); runbook includes test restore.
- Test Plan: integration test for snapshot job creating restore point; manual restore drill documented and automated smoke where feasible.
- Commits: -

### CLOUD-0204 (P0) 2.4 Self-service Restore UI

- Status: TODO
- Depends on: CLOUD-0202, CLOUD-0102
- Acceptance Criteria: restore file/folder/project to original or new location; audit logs for restore; end-to-end tested.
- Test Plan: e2e restore flows; integration tests for authorization and audit emission.
- Commits: -

### CLOUD-0205 (P1) 2.5 Ransomware-safe Backups (Immutable/WORM)

- Status: TODO
- Depends on: CLOUD-0203
- Acceptance Criteria: immutable backups with separate credentials and no delete permission; configuration documented; verification job proves immutability.
- Test Plan: integration tests for verification job; negative tests: deletion attempts fail.
- Commits: -

### CLOUD-0206 (P1) 2.6 DR Runbook UI

- Status: TODO
- Depends on: CLOUD-0203, CLOUD-0205
- Acceptance Criteria: UI wizard for DR steps; execution logs persisted; viewable history; audited.
- Test Plan: integration tests for run execution persistence; e2e: run wizard and verify logs stored.
- Commits: -

## Epic 3: Compliance & Audit (Expand)

### CLOUD-0301 (P0) 3.1 Expand Audit Coverage

- Status: TODO
- Depends on: CLOUD-0102
- Acceptance Criteria: audit coverage for file access, permission changes, PAT create/revoke, deploy actions; automated tests for key endpoints.
- Test Plan: integration tests asserting audit events exist for key actions; e2e spot-check: download/share/export.
- Commits: -

### CLOUD-0302 (P1) 3.2 Retention Policies (Audit)

- Status: TODO
- Depends on: CLOUD-0102
- Acceptance Criteria: admin UI to set retention per category; background purge job with tombstones (hash chain preserved); exports reflect rules.
- Test Plan: unit tests for purge logic; integration tests for tombstone behavior; e2e: set retention and verify purge.
- Commits: -

### CLOUD-0303 (P1) 3.3 Tamper-evidence Verification UI

- Status: TODO
- Depends on: CLOUD-0102
- Acceptance Criteria: admin “Verify logs” runs chain verification and reports status/reason.
- Test Plan: integration tests for verify endpoint; UI smoke; scripted tamper test.
- Commits: -

## Epic 4: Sharing & Collaboration

### CLOUD-0401 (P0) 4.1 Advanced Link Sharing

- Status: TODO
- Depends on: CLOUD-0101
- Acceptance Criteria: expiry, password, upload/download rules, max downloads, optional IP allowlist, revoke; server enforcement with tests.
- Test Plan: integration tests for enforcement; e2e: create link with expiry/password/max downloads and verify behavior.
- Commits: -

### CLOUD-0402 (P0) 4.2 Workspaces / Team Spaces

- Status: TODO
- Depends on: CLOUD-0103
- Acceptance Criteria: workspace model + membership + roles; UI switcher/invites/role mgmt; RBAC everywhere; cross-workspace access blocked in tests.
- Test Plan: integration tests for authz boundaries; e2e: invite user, switch workspace, verify isolation.
- Commits: -

### CLOUD-0403 (P1) 4.3 Comments / Annotations

- Status: TODO
- Depends on: CLOUD-0402
- Acceptance Criteria: comment threads with anchors; UI in previews; mentions trigger notifications.
- Test Plan: integration tests for create/resolve/mention; e2e: create thread and verify notification.
- Commits: -

### CLOUD-0404 (P1) 4.4 Presence

- Status: TODO
- Depends on: CLOUD-0403
- Acceptance Criteria: minimal presence via WS/SSE; UI shows “X viewing”; multiple sessions update.
- Test Plan: integration tests for presence fanout; e2e: two sessions show presence.
- Commits: -

## Epic 5: Sync & Offline

### CLOUD-0501 (P0) 5.1 Sync API (Delta Listing)

- Status: TODO
- Depends on: CLOUD-0402, CLOUD-0202
- Acceptance Criteria: endpoints list changes since cursor, upload/download by hash/version, conflict detection with etags/hashes.
- Test Plan: integration tests for delta cursor and conflict; e2e: sync client smoke with conflict.
- Commits: -

### CLOUD-0502 (P1) 5.2 Desktop Sync Client (CLI)

- Status: TODO
- Depends on: CLOUD-0501, CLOUD-0701
- Acceptance Criteria: `pondcloud` CLI login (device code/oauth) + PAT fallback; init/selective sync/bw limit; conflict keep-both; packaging docs.
- Test Plan: integration test in repo (spawn CLI); e2e: create conflict and verify resolution.
- Commits: -

### CLOUD-0503 (P1) 5.3 Mobile Upload API

- Status: TODO
- Depends on: CLOUD-0201
- Acceptance Criteria: camera folder rule; background token; chunk uploads; works under poor network.
- Test Plan: integration tests for chunk assembly + resume; e2e: simulated flaky upload.
- Commits: -

### CLOUD-0504 (P2) 5.4 Offline Cache (MVP)

- Status: TODO
- Depends on: CLOUD-0502
- Acceptance Criteria: client caches metadata + last versions; offline marked files readable.
- Test Plan: CLI integration tests; manual offline drill.
- Commits: -

## Epic 6: Automation

### CLOUD-0601 (P1) 6.1 Scheduler Service

- Status: TODO
- Depends on: CLOUD-0402
- Acceptance Criteria: per-workspace cron jobs; job types mirror/pdf/report/cleanup; UI create/run/logs; job runs and logs output.
- Test Plan: integration tests for cron parser + execution; e2e: create job and run now.
- Commits: -

### CLOUD-0602 (P1) 6.2 Event Bus + Pipeline

- Status: TODO
- Depends on: CLOUD-0102
- Acceptance Criteria: events emitted (file uploaded/share created/deploy done/ticket changed); pipeline with retries; sample pipeline upload->scan->tag->notify.
- Test Plan: unit tests for retries/idempotency; integration test pipeline execution.
- Commits: -

### CLOUD-0603 (P1) 6.3 Webhooks

- Status: TODO
- Depends on: CLOUD-0602
- Acceptance Criteria: user webhooks with signing secret; retries + DLQ; UI management; signed requests proven in tests.
- Test Plan: integration tests for signing + retry + DLQ; e2e: webhook delivery simulated.
- Commits: -

### CLOUD-0604 (P2) 6.4 Rules Engine (IFTTT light)

- Status: TODO
- Depends on: CLOUD-0602
- Acceptance Criteria: UI builder trigger/condition/action; safe execution (timeouts/quotas); idempotent exactly-once per event.
- Test Plan: unit tests for idempotency; integration tests for rule execution quotas/timeouts.
- Commits: -

## Epic 7: Integrations & API

### CLOUD-0701 (P0) 7.1 Public API v1

- Status: TODO
- Depends on: CLOUD-0103, CLOUD-0402
- Acceptance Criteria: PAT + scopes + rotation; OpenAPI spec generated + served + Swagger UI; scope enforcement tests.
- Test Plan: integration tests for PAT scopes; e2e: CLI uses PAT to call API.
- Commits: -

### CLOUD-0702 (P1) 7.2 Integrations

- Status: TODO
- Depends on: CLOUD-0701
- Acceptance Criteria: implement at least one integration end-to-end (GitHub/GitLab OAuth or Slack notifications); others pluggable; LDAP/AD optional behind flag.
- Test Plan: integration tests with mocked providers; e2e: one provider flow works.
- Commits: -

### CLOUD-0703 (P1) 7.3 CLI Tool Expand

- Status: TODO
- Depends on: CLOUD-0701
- Acceptance Criteria: CLI supports upload/download/search/share/audit tail; documented in `/docs/cli.md`.
- Test Plan: CLI integration tests; e2e: smoke script uses CLI for core actions.
- Commits: -

## Epic 8: Security Hardening (Deep)

### CLOUD-0801 (P0) Malware Scan Integration

- Status: TODO
- Depends on: CLOUD-0201
- Acceptance Criteria: malware scanning in upload pipeline; quarantine flow; flagged files blocked; audited.
- Test Plan: integration tests using EICAR-like fixture handling; e2e: upload triggers quarantine.
- Commits: -

### CLOUD-0802 (P0) SSRF Guard

- Status: TODO
- Depends on: CLOUD-0101
- Acceptance Criteria: any server-side fetch uses SSRF guard; private IP ranges blocked; tests prove block.
- Test Plan: unit tests for allow/deny lists; integration tests for blocked fetch endpoints.
- Commits: -

### CLOUD-0803 (P0) HTML Sanitization In Previews

- Status: TODO
- Depends on: CLOUD-0101
- Acceptance Criteria: markdown/html previews sanitized; XSS injection blocked in tests; CSP aligns with sanitized output.
- Test Plan: unit tests for sanitizer; e2e: attempt XSS in preview blocked.
- Commits: -

### CLOUD-0804 (P1) CSP Nonce + Strict Policy

- Status: TODO
- Depends on: CLOUD-0101
- Acceptance Criteria: CSP uses nonces for scripts; inline scripts blocked; tests assert header present and correct.
- Test Plan: integration tests on responses; browser e2e smoke for app load.
- Commits: -

### CLOUD-0805 (P0) Secrets Management Module

- Status: TODO
- Depends on: CLOUD-0103
- Acceptance Criteria: encrypted secrets store; rotation support; runbook; secure defaults.
- Test Plan: unit tests for encryption/rotation; integration tests for access control and audit.
- Commits: -

### CLOUD-0806 (P2) Optional At-rest Encryption Hooks (Per Workspace)

- Status: TODO
- Depends on: CLOUD-0201, CLOUD-0402
- Acceptance Criteria: pluggable encryption hooks; per-workspace keys; documented limitations.
- Test Plan: integration tests for encrypt/decrypt path; negative tests for key mismatch.
- Commits: -

## Epic 9: Data Organization

### CLOUD-0901 (P1) Tags + Smart Folders + Saved Searches

- Status: TODO
- Depends on: CLOUD-0402
- Acceptance Criteria: tags on files; smart folders; saved searches; UI management.
- Test Plan: integration tests for tag CRUD + search; e2e: create tag and filter.
- Commits: -

### CLOUD-0902 (P1) Metadata Extraction (EXIF/PDF/Office)

- Status: TODO
- Depends on: CLOUD-0201
- Acceptance Criteria: extraction pipeline stores metadata and searchable text; search returns extracted text.
- Test Plan: integration tests on fixture files; e2e: search finds PDF text.
- Commits: -

### CLOUD-0903 (P1) Duplicate Detection + Cleanup UI

- Status: TODO
- Depends on: CLOUD-0201
- Acceptance Criteria: content hashing; groups duplicates; cleanup UI; audit actions.
- Test Plan: integration tests for hashing and grouping; e2e: duplicate suggested and cleaned up.
- Commits: -

### CLOUD-0904 (P0) Quotas Enforcement + UI Usage

- Status: TODO
- Depends on: CLOUD-0101
- Acceptance Criteria: quota enforcement on uploads/sync/deploy; UI usage dashboards; blocks uploads when exceeded.
- Test Plan: integration tests for quota limits; e2e: exceed quota blocks.
- Commits: -

## Epic 10: Productivity Layer

### CLOUD-1001 (P1) Markdown Wiki + Backlinks

- Status: TODO
- Depends on: CLOUD-0402, CLOUD-0902
- Acceptance Criteria: create/edit wiki pages; backlinks work; searchable.
- Test Plan: integration tests for page CRUD + backlinks; e2e: create pages and verify links.
- Commits: -

### CLOUD-1002 (P2) Snippets Library

- Status: TODO
- Depends on: CLOUD-0402
- Acceptance Criteria: snippet CRUD; permissions; search.
- Test Plan: integration tests; UI smoke.
- Commits: -

### CLOUD-1003 (P1) Bookmarks / Web Clips (Safe Fetch)

- Status: TODO
- Depends on: CLOUD-0802
- Acceptance Criteria: save web clips via safe fetch; sanitized content; audited.
- Test Plan: SSRF negative tests; integration tests for clipping.
- Commits: -

### CLOUD-1004 (P2) Kanban Light Tasks Linked To Files/Tickets

- Status: TODO
- Depends on: CLOUD-0402
- Acceptance Criteria: tasks board; link to file/ticket; basic workflow.
- Test Plan: integration tests for task CRUD; e2e: create task and link.
- Commits: -

## Epic 11: Communication

### CLOUD-1101 (P0) In-app Notifications + Preferences

- Status: TODO
- Depends on: CLOUD-0403
- Acceptance Criteria: notifications for mentions/shares; per-user prefs; UI.
- Test Plan: integration tests for notify on mention; e2e: mention triggers notification.
- Commits: -

### CLOUD-1102 (P1) Activity Feed Per Workspace

- Status: TODO
- Depends on: CLOUD-0301, CLOUD-0402
- Acceptance Criteria: feed shows key events; filterable; audited.
- Test Plan: integration tests for feed entries; e2e: actions appear in feed.
- Commits: -

### CLOUD-1103 (P2) Optional Chat (Flagged) Or Matrix Bridge

- Status: TODO
- Depends on: CLOUD-1101
- Acceptance Criteria: minimal chat behind flag or bridge integration; safe defaults.
- Test Plan: integration tests for messaging/bridge; UI smoke.
- Commits: -

## Epic 12: Deployment / Runtime

### CLOUD-1201 (P0) One-click Deploy Runner

- Status: TODO
- Depends on: CLOUD-0402, CLOUD-0102
- Acceptance Criteria: deploy runner (container or sandbox); audited deploy actions; logs + metrics per app.
- Test Plan: integration tests for deploy lifecycle; e2e: deploy hello-world from UI.
- Commits: -

### CLOUD-1202 (P0) Environments (Dev/Stage/Prod)

- Status: TODO
- Depends on: CLOUD-1201
- Acceptance Criteria: env separation; configuration model; UI + API supports env selection; migration/rollback documented.
- Test Plan: integration tests for env scoping; e2e: deploy to stage then promote.
- Commits: -

### CLOUD-1203 (P0) Secure Secrets Injection (Per Project)

- Status: TODO
- Depends on: CLOUD-0805, CLOUD-1201
- Acceptance Criteria: secrets per project injected securely; rotation; no plaintext leaks; audited access.
- Test Plan: unit tests for secret encryption; integration tests for injection; e2e: deploy uses secret.
- Commits: -

### CLOUD-1204 (P1) Observability (Logs/Metrics/Health)

- Status: TODO
- Depends on: CLOUD-0101
- Acceptance Criteria: structured logs; metrics endpoints; health checks for all services; dashboards/runbooks documented.
- Test Plan: integration tests for health endpoints; smoke tests for metrics.
- Commits: -

### CLOUD-1205 (P1) Custom Domains + TLS Automation (ACME)

- Status: TODO
- Depends on: CLOUD-1201
- Acceptance Criteria: custom domains; safe ACME automation; rollback plan; security controls; audited.
- Test Plan: staging ACME tests; integration tests for domain mapping; e2e: access deployed app via domain.
- Commits: -

## Finalization (Must Be Last)

### CLOUD-9901 (P0) Docs + Operations + Release Checklist

- Status: TODO
- Depends on: all epics done
- Acceptance Criteria: `/docs/operations.md`, `/docs/migrations.md`, `/docs/release.md` exist and match implementation; feature flags documented.
- Test Plan: doc review + ops smoke drills.
- Commits: -

### CLOUD-9902 (P0) Full Suite Green + Security Smoke

- Status: TODO
- Depends on: CLOUD-9901
- Acceptance Criteria: full test suite green; e2e smoke list passes; no critical findings in self-tests (XSS/CSRF/SSRF/upload).
- Test Plan: run CI-equivalent command set; keep artifacts.
- Commits: -
