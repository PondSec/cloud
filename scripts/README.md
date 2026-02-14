# Scripts

This folder contains operational and migration scripts used by the platform.

Rules:
- Scripts must be idempotent where possible.
- Scripts must log clearly and exit non-zero on failure.
- Any backfill/migration must have a rollback or safe stop plan documented in an ADR.

