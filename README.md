# DocSmith Technical Documentation

DocSmith is a full-stack document generation and workspace collaboration platform designed for enterprise use, with deep AI integration, robust file management, and secure customer-centric workflows. This README provides technical documentation suitable for app review, onboarding, and developer reference.

---

## Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Core Features](#core-features)
- [Setup & Installation](#setup--installation)
- [Configuration](#configuration)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [Document Generation Pipeline](#document-generation-pipeline)
- [AnythingLLM Integration](#anythingllm-integration)
- [Logging & Temp File Management](#logging--temp-file-management)
- [Security](#security)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Overview
DocSmith automates the creation of complex documents (Word, Excel) using dynamic templates, AI-powered context, and asynchronous job tracking. It supports customer management, secure file uploads, and integration with AnythingLLM for chat-based workspaces and document context.

## Architecture
- **Backend**: Express + TypeScript, service-oriented, SQLite (raw SQL)
- **Frontend**: React SPA, shadcn/ui, Tailwind CSS, hash-based routing
- **Electron**: Desktop app with IPC, contextBridge, file system access
- **File System**: Customer-centric folders, template library, job tracking
- **Database**: SQLite, schema in `backend/src/db/schema.sql`

### Directory Structure
```
backend/         # API, services, database
frontend/        # React SPA
electron/        # Electron main & preload scripts
 data/
   customers/    # Per-customer files
   templates/    # Template library
 .jobs/          # Job tracking
```

## Core Features
- Customer management (CRUD, uploads, prompts)
- Template system (TypeScript generators, DOCX/Excel)
- Document generation (async jobs, AI context)
- AnythingLLM integration (workspaces, threads, chat)
- Job monitoring (persistent status, logs)
- Electron desktop support (local file access, logs)
- Temp file cleanup (automatic/manual)

## Setup & Installation
```bash
# Install dependencies
npm install

# Start backend & frontend
npm run dev

# Start Electron desktop app
npm run electron:dev

# Build for production
npm run build
```

## Configuration
- **Settings**: Managed via `/api/settings` and frontend Settings page
- **AnythingLLM**: Configure API URL and key in Settings
- **First-run wizard**: Guides initial setup, stores config in localStorage

## Database Schema
See `backend/src/db/schema.sql` for full schema. Key tables:
- `customers`: Customer records
- `prompts`: AI prompt history
- `documents`: Generated documents
- `gen_cards`: Job tracking
- `settings`: App configuration

## API Reference
- `/api/customers` (GET, POST, PUT, DELETE)
- `/api/templates` (GET, POST, DELETE)
- `/api/generate` (POST, GET jobs)
- `/api/settings` (GET, POST)
- `/api/anythingllm/*` (workspace, thread, chat)

## Document Generation Pipeline
1. **Template Discovery**: Find templates in `data/templates/{TemplateName}/`
2. **AI Context Building**: Use AnythingLLM workspace for context
3. **Dynamic Generation**: TypeScript generator produces Word XML (WML)
4. **Document Assembly**: Pandoc (preferred) or html-to-docx fallback
5. **Job Tracking**: Status and logs in `.jobs/jobs.json` and `gen_cards` table

## AnythingLLM Integration
- **Workspaces**: Create/delete, embed documents
- **Threads**: Chat threads per workspace
- **Streaming Chat**: SSE-based real-time chat
- **Configuration**: API URL/key in Settings

## Logging & Temp File Management
- **Electron logs**: `docsmith-electron.log` in system temp folder
- **Log rotation**: 5MB/10,000 lines, auto-trim
- **Temp file cleanup**: Automatic on startup, manual via Settings
- **Pandoc temp dirs**: Cleaned after use and via cleanup routines
- **Job logs**: Persistent in `.jobs/` and database

## Security

DocSmith is designed with multiple layers of security controls:

- **SQL Injection Protection**: All database queries use parameterized statements; no direct string interpolation. Raw SQL is validated and never built from user input.
- **Path Traversal Prevention**: All file/folder operations sanitize user-supplied names and restrict access to canonical customer directories. No user input is used for direct file system paths.
- **Electron IPC Safety**: Only safe, whitelisted IPC channels are exposed to the renderer via contextBridge. No arbitrary file system or OS access is possible from the frontend.
- **Log & Temp File Management**: Logs and temp files are stored in isolated locations, auto-rotated, and cleaned up regularly. No sensitive data (secrets, tokens, passwords) is written to logs or temp files.
- **Dependency Audits**: Regular `npm audit` checks are performed. All known vulnerabilities are patched promptly; upgrade instructions are provided for any moderate/high issues.
- **Customer Data Isolation**: All customer files are stored in separate, sanitized folders. No cross-customer access is possible.
- **AnythingLLM API Security**: API keys and URLs are stored securely and never exposed to the frontend. All requests are authenticated.
- **Frontend Browser Safety**: No direct file system access from the browser. All uploads and downloads are routed through secure backend endpoints.

For a full security review, see the technical documentation or contact the maintainers.

## Testing
- **Backend**: HTTP tests in `backend/tests.http`
- **Frontend**: Manual and automated UI tests
- **Electron**: IPC and file system tests

## Deployment
- **Web**: Build frontend and backend, deploy as web app
- **Desktop**: Electron build scripts, packaged installers
- **Multi-target**: npm workspaces, coordinated builds

## Troubleshooting
- **Logs**: View via Settings → Development Tools
- **Temp files**: Clean via Settings or on startup
- **Job errors**: Check `.jobs/` and job status in UI
- **AnythingLLM**: Verify API URL/key in Settings

## Contributing
1. Fork and clone the repo
2. Install dependencies
3. Use provided scripts for dev/build
4. Submit PRs with clear descriptions

## License
MIT

---
For full technical details, see the Help page in the app or contact the maintainers.
