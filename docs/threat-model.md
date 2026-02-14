# Threat Model

Last updated: 2026-02-14

This is an evolving threat model for the system described in `/docs/system-map.md`.

## Assets

- User identities and credentials
- Access/refresh tokens (Cloud + IDE)
- File contents (blobs) and metadata
- Audit logs (integrity + export)
- Workspace code and runner/container runtime state
- Secrets (OnlyOffice secrets, runner shared secret, encryption keys, integration secrets)

## Trust Boundaries

- Public internet: browsers and external clients
- Frontend <-> Cloud backend API boundary
- Cloud backend <-> DB/storage boundary
- IDE backend <-> runner boundary (internal network)
- Runner <-> docker.sock boundary (high privilege)
- External services: InventoryPro and IMAP/SMTP servers

## Primary Threats (STRIDE-ish)

Spoofing
- Token theft or replay (access/refresh, PATs later).
- Runner secret leakage enabling unauthorized workspace/container control.

Tampering
- Audit log manipulation (requires tamper-evidence + verification).
- File blob tampering or unauthorized overwrite.

Repudiation
- Missing or incomplete audit coverage for sensitive actions.

Information Disclosure
- XSS/preview rendering leading to token or data exfiltration.
- SSRF in any server-side fetch feature (web clips, integrations).
- Over-broad CORS/origin policy.

Denial of Service
- Upload abuse, expensive endpoints, brute force attempts.
- Job scheduler or webhook retry storms (future).

Elevation of Privilege
- RBAC bypass via IDOR (cross-workspace access).
- Runner escape via docker privileges or misconfiguration.

## Current Mitigations (As Implemented)

- RBAC enforcement on Cloud endpoints.
- Safe storage path resolution to prevent traversal.
- Login brute-force throttling (in-memory windowed limiter).
- Security headers on backend responses.
- Optional CSRF origin/referrer protection (behind flag).
- Optional global request rate limiting (behind flag).

## Gaps (Planned Work)

- Persistent refresh token rotation store + reuse detection (HA-safe).
- MFA (WebAuthn + TOTP) and elevated admin sessions.
- Tamper-evident audit log hash chain + verification tooling/UI.
- Malware scanning and quarantine for uploads.
- SSRF guard + HTML sanitization for previews.
- Storage abstraction + versioning + immutable backups.

