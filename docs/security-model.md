# Security Model

Last updated: 2026-02-14

This document describes the security model for the Cloud platform in this repo.

## Principles

- Secure-by-default configurations in production.
- New capabilities ship behind feature flags (default OFF) and are enabled progressively.
- Defense in depth: authz checks, audit logging, rate limits, safe storage path handling.
- Minimize blast radius for high-privilege components (notably the IDE runner).

## Identity & AuthN (Current)

- Cloud backend uses JWT access + refresh tokens.
- Passwords are stored using Argon2 hashing.
- Refresh token reuse detection exists but is currently in-memory (not HA-safe).
- InventoryPro integration can provide SSO ticket exchange (optional).

## AuthZ / RBAC (Current)

- Role-based access control (roles -> permissions).
- Backend endpoints enforce permissions via decorators and helper checks.

## Transport / Network

- HTTPS is required for production deployments.
- HSTS is only emitted when requests are served over HTTPS.

## App-Layer Protections (Baseline)

Security headers (backend responses)
- `Content-Security-Policy` (static baseline policy for API responses)
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy` restrictive defaults

CSRF protection
- Baseline CSRF protection is implemented as Origin/Referer validation for state-changing requests.
- Controlled via feature flag `security.csrf` (default OFF).

Rate limiting
- In-memory request rate limiting is available as global middleware (IP + user + endpoint class).
- Controlled via feature flag `security.rate_limit` (default OFF).

Cookies
- Cookie defaults are configured to prefer secure attributes (`HttpOnly`, `SameSite=Lax`, `Secure` in production).

Audit logging
- Primary audit log: `audit_logs` (non-hash-chained, used by current UI).
- Tamper-evident audit log: `audit_events` (hash-chained; flag `audit.hash_chain`).
- Verification script: `/scripts/verify-audit-chain`.

## Storage

- File blobs are stored on the local filesystem under `STORAGE_ROOT`.
- Storage paths are resolved with a safe root containment check to prevent path traversal.

## High-Privilege Components

IDE runner
- Runner authenticates all HTTP/WS traffic using a shared secret header.
- Runner has access to `docker.sock` and must never be exposed publicly.

## Feature Flags

Feature flags are defined in `/config/feature-flags.json`.

Rules
- Default OFF for new functionality.
- Production rollout should be staged (admin-only first where applicable).
