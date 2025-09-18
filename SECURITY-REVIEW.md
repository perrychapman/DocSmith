# DocSmith Security Review

_Last updated: September 18, 2025_

This document provides a comprehensive security review of the DocSmith platform, covering backend, frontend, Electron, file system, logging, and dependency management. It is intended for app reviewers, compliance teams, and contributors.

---

## 1. SQL Injection Protection
- All database queries use parameterized statements (no direct string interpolation).
- Raw SQL is validated and never built from user input.
- No ORM is used; queries are written and reviewed for safety.

## 2. Path Traversal & File Name Sanitization
- All file/folder operations sanitize user-supplied names using strict helper functions.
- Only canonical, customer-specific directories are used for file storage.
- No user input is used for direct file system paths; traversal attempts are blocked.

## 3. Electron IPC & Desktop Security
- Only safe, whitelisted IPC channels are exposed to the renderer via contextBridge.
- No arbitrary file system or OS access is possible from the frontend.
- Log and temp file access is restricted to dedicated locations.

## 4. Logging & Temp File Management
- Logs and temp files are stored in isolated locations, auto-rotated, and cleaned up regularly.
- No sensitive data (secrets, tokens, passwords) is written to logs or temp files.
- Manual and automatic cleanup routines prevent data retention risks.

## 5. Dependency Vulnerability Management
- Regular `npm audit` checks are performed for all workspaces (backend, frontend, electron).
- All known vulnerabilities are patched promptly; upgrade instructions are provided for any moderate/high issues.
- No critical or high vulnerabilities are present in the current codebase.

## 6. Customer Data Isolation
- All customer files are stored in separate, sanitized folders.
- No cross-customer access is possible.

## 7. AnythingLLM API Security
- API keys and URLs are stored securely and never exposed to the frontend.
- All requests to AnythingLLM are authenticated and validated.

## 8. Frontend Browser Safety
- No direct file system access from the browser.
- All uploads and downloads are routed through secure backend endpoints.

## 9. Additional Controls
- CORS is controlled on the backend API.
- Electron app disables nodeIntegration and enables contextIsolation for renderer security.
- All settings and configuration changes are validated before use.

---

## Summary
DocSmith is designed with defense-in-depth security controls across all layers. All major risks (SQL injection, path traversal, IPC exposure, log/temp file leaks, dependency vulnerabilities) are actively mitigated and reviewed. For questions or compliance requests, contact the maintainers.

---

_This review should be included in app review submissions and referenced in technical documentation._
