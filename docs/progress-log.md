# Progress Log

This file is appended after each implemented step.

## 2026-02-14

- Phase 0 completed: repo inventory + documentation scaffolding.
- Added as-is architecture docs: `/docs/current-architecture.md`, `/docs/system-map.md`.
- Added project skeleton: `/docs/decisions/`, `/docs/runbooks/`, `/config/feature-flags.json`, `/scripts/`, `/services/`.
- Added master backlog: `/docs/roadmap.md` (Epics 1..12 + finalization).
- Fixed OnlyOffice API aliasing: ensured `/api/office/*` routes exist (kept legacy `/api/*` alias temporarily) so signed file URLs work and tests pass.
- Phase 1.1 completed (Security baseline):
- Added feature flags loader (`/config/feature-flags.json` -> backend `FEATURE_FLAGS`).
- Added CSRF origin/referrer protection for state-changing requests (flag: `security.csrf`).
- Added global API rate limiting middleware (flag: `security.rate_limit`).
- Added baseline secure cookie defaults in backend config.
- Added `/docs/security-model.md` and `/docs/threat-model.md`.
- Phase 1.2 completed (Audit event bus skeleton):
- Added hash-chained `audit_events` table + SQLAlchemy model.
- Implemented central audit bus (`audit.emit`) behind `audit.hash_chain`.
- Added admin export/listing endpoints for hash-chained events (`/api/audit/events`).
- Added `/scripts/verify-audit-chain`.
- Ensured auth refresh + logout emit audit events; frontend logout calls `/auth/logout` best-effort.
