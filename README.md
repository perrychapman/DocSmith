# DocSmith

**AI-Enhanced Document Generation Platform**

DocSmith is a desktop application for automated document generation with AI-powered templates. Built with Electron, React, and TypeScript, it combines intelligent template processing with seamless workspace integration to produce professional Word and Excel documents at scale.

---

## Table of Contents
- [Overview](#overview)
- [Key Features](#key-features)
- [Technology Stack](#technology-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Document Generation](#document-generation)
- [Template System](#template-system)
- [Database Migrations](#database-migrations)
- [AnythingLLM Integration](#anythingllm-integration)
- [Auto-Updates](#auto-updates)
- [Security](#security)
- [Building & Deployment](#building--deployment)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

DocSmith streamlines document generation workflows by combining customer data management, AI-powered template processing, and automated document assembly. The application supports complex document structures including tables, nested lists, and dynamic content while maintaining professional formatting through WordprocessingML (WML) generation.

### Use Cases

- **Enterprise Reporting**: Generate monthly reports, financial statements, and executive summaries from structured data
- **Contract Generation**: Create customized agreements, proposals, and legal documents with dynamic clauses
- **Data Export**: Transform database records into formatted spreadsheets and Word documents
- **Bulk Document Processing**: Process multiple documents with consistent formatting and branding

---

## Key Features

### Customer Management
- Comprehensive CRUD operations for customer records
- Workspace linking with AnythingLLM for context-aware generation
- Customer-specific file storage and organization
- Bulk document processing per customer

### Template System
- TypeScript-based template generators with full type safety
- Dynamic and static template modes for flexibility
- Support for DOCX and Excel output formats
- AI-assisted template enhancement using workspace context
- Version-controlled template caching with automatic invalidation

### Document Generation
- Asynchronous job queue with real-time status tracking
- Pandoc integration for high-fidelity document assembly
- Fallback HTML-to-DOCX conversion for portability
- Comprehensive error handling and logging
- Progress monitoring via Server-Sent Events

### AI Integration
- Native AnythingLLM workspace integration
- Document indexing for semantic search
- Template enhancement with workspace-specific data
- Metadata extraction from uploaded documents
- Chat-based document queries

### Desktop Features
- Cross-platform Electron application (Windows, macOS, Linux)
- Auto-update system with delta downloads
- Native file system integration
- Local SQLite database with migration support
- System tray integration and background processing

---

## Technology Stack

### Backend
- **Runtime**: Node.js 20.x
- **Framework**: Express.js with TypeScript
- **Database**: SQLite3 with parameterized queries
- **Document Processing**: Pandoc, ExcelJS, html-to-docx
- **Build**: esbuild for fast compilation

### Frontend
- **Framework**: React 18 with TypeScript
- **UI Library**: shadcn/ui components
- **Styling**: Tailwind CSS
- **Build Tool**: Vite
- **Routing**: Hash-based client-side routing

### Desktop
- **Platform**: Electron 38.x
- **Updates**: electron-updater with GitHub releases
- **IPC**: Secure contextBridge implementation
- **Icons**: Multi-platform icon generation (ICO, ICNS, PNG)

---

## Architecture

### Application Structure

```
DocSmith/
├── backend/
│   ├── src/
│   │   ├── api/          # REST endpoints
│   │   ├── services/     # Business logic
│   │   ├── db/           # Schema and migrations
│   │   └── utils/        # Helpers and configuration
│   └── dist/             # Compiled backend
├── frontend/
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── pages/        # Route pages
│   │   ├── contexts/     # React Context providers
│   │   └── lib/          # Utilities and API client
│   └── dist/             # Production build
├── electron/
│   ├── main.ts           # Electron main process
│   └── preload.ts        # IPC bridge
├── data/
│   ├── customers/        # Customer-specific files
│   ├── templates/        # Template library
│   └── .config/          # Application settings
└── dist-release/         # Built installers
```

### Service-Oriented Design

The backend follows a service-oriented architecture with clear separation of concerns:

- **API Layer** (`backend/src/api/`): Express routers handling HTTP requests
- **Service Layer** (`backend/src/services/`): Core business logic and data processing
- **Database Layer** (`backend/src/db/`): Schema definitions and migration system
- **Utilities** (`backend/src/utils/`): Configuration, logging, and shared helpers

### Data Flow

1. **User Input**: Frontend sends request via REST API or Electron IPC
2. **Service Processing**: Backend service validates and processes request
3. **Database Operations**: SQLite handles data persistence with parameterized queries
4. **AI Enhancement**: Optional AnythingLLM integration for context
5. **Document Assembly**: Template generator produces WML, assembled via Pandoc
6. **Response**: Status updates via SSE, final document returned or saved locally

---

## Getting Started

### Prerequisites

- Node.js 20.x or higher
- npm 10.x or higher
- Git
- (Optional) Pandoc for enhanced document assembly
- (Optional) AnythingLLM instance for AI features

### Installation

```bash
# Clone repository
git clone https://github.com/perrychapman/DocSmith.git
cd DocSmith

# Install dependencies
npm install

# Install backend dependencies
npm --workspace backend install

# Install frontend dependencies
npm --workspace frontend install
```

### Development Mode

```bash
# Start backend and frontend with hot reload
npm run dev

# Start Electron desktop app with dev tools
npm run electron:dev
```

The application will be available at:
- **Web**: http://localhost:5173
- **Backend API**: http://localhost:4000
- **Electron**: Desktop window

### First-Run Setup

On first launch, the setup wizard will guide you through:

1. **AnythingLLM Configuration**: API URL and authentication key
2. **Workspace Creation**: Initial workspace setup
3. **Database Initialization**: Schema creation and default settings

Settings are stored in `data/.config/settings.json` and can be modified via the Settings page.

---

## Document Generation

### Generation Workflow

DocSmith uses an asynchronous job system for document generation:

1. **Job Creation**: User selects customer, template, and optional parameters
2. **Context Resolution**: System determines workspace and loads template
3. **AI Enhancement**: Template generator is optionally enhanced with workspace data
4. **Execution**: Generator runs in sandboxed VM, produces WML/Excel structures
5. **Assembly**: WML merged into DOCX template via Pandoc or HTML conversion
6. **Completion**: Document saved to customer folder, job marked complete

### Job Tracking

All generation jobs are tracked with:
- Unique job ID (UUID)
- Customer and template references
- Status (pending, running, completed, failed, cancelled)
- Detailed step-by-step logs
- Start and completion timestamps
- Output file paths

Jobs persist in both:
- `.jobs/jobs.json` (immediate access, in-memory cache)
- `gen_cards` database table (permanent record)

### Real-Time Monitoring

The frontend subscribes to job status via Server-Sent Events:

```typescript
const eventSource = new EventSource('/api/generate/stream');
eventSource.onmessage = (event) => {
  const status = JSON.parse(event.data);
  // Update UI with current job status
};
```

---

## Template System

### Template Structure

Each template is a directory in `data/templates/` containing:

```
TemplateName/
├── template.json         # Metadata and configuration
├── template.docx         # Reference DOCX for styling
├── generator.full.ts     # TypeScript generator function
└── .cache/               # Cached AI-enhanced generators
    └── generator.full.{workspace}.ts
```

### Template Metadata

`template.json` defines template configuration:

```json
{
  "name": "Monthly Report",
  "slug": "monthly-report",
  "output": {
    "format": "docx",
    "filenamePattern": "{CustomerName}_Report_{Month}_{Year}.docx"
  },
  "dynamic": {
    "mode": "static"
  }
}
```

### Generator Contract

All generators must export an async `generate()` function:

```typescript
export async function generate(
  toolkit: {
    json: (prompt: string) => Promise<any>;
    text: (prompt: string) => Promise<string>;
    query: (prompt: string) => Promise<any>;
  },
  builder: any,
  context?: Record<string, any>
): Promise<{ wml: string }> {
  // Generate WordprocessingML
  return {
    wml: `<w:p>...</w:p>`
  };
}
```

### Static vs Dynamic Mode

**Static Mode** (default):
- Toolkit methods disabled at runtime
- AI enhancement pre-fetches all data and hardcodes in WML
- Cached per workspace for 15 minutes
- Best for: Consistent reports, high-volume generation

**Dynamic Mode**:
- Toolkit methods enabled at runtime
- Generator makes intelligent decisions per generation
- Uses context parameter for customization
- Best for: User-driven customization, real-time data

### AI Enhancement

When generating documents, templates are optionally enhanced by AI:

1. **Load Original**: Read `generator.full.ts` from disk
2. **Analyze Structure**: Extract document structure (tables, lists, word count)
3. **Check Cache**: Look for cached version specific to workspace
4. **AI Enhancement**: Send generator + structure to AnythingLLM workspace
5. **Code Update**: AI modifies generator to incorporate workspace data
6. **Cache**: Save enhanced generator for future use
7. **Execute**: Run enhanced generator to produce document

Cache invalidation occurs when:
- Source `generator.full.ts` is modified (mtime check)
- Cache TTL expires (15 minutes default)
- User forces refresh with `refresh=true` parameter

---

## Database Migrations

DocSmith uses a versioned migration system for safe schema updates.

### Migration System

All migrations are defined in `backend/src/services/migrations.ts`:

```typescript
const migrations: Migration[] = [
  {
    version: 1,
    name: "add-workspace-slug-to-customers",
    up: async (db: sqlite3.Database) => {
      // Migration logic
    }
  }
];
```

### Migration Tracking

The `schema_migrations` table tracks applied migrations:

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Automatic Execution

Migrations run automatically on application startup:
- Check current schema version
- Apply pending migrations sequentially
- Record each successful migration
- Fail-safe: Stop on error, preserve data

### Migration Status API

Check migration status via REST endpoint:

```bash
GET /api/settings/migrations

Response:
{
  "currentVersion": 3,
  "latestVersion": 3,
  "appliedMigrations": [...],
  "pendingMigrations": []
}
```

---

## AnythingLLM Integration

DocSmith integrates deeply with AnythingLLM for AI-powered features.

### Workspace Management

- **Create Workspaces**: Automatic workspace creation per customer
- **Document Upload**: Upload customer files to workspaces for semantic search
- **Embedding Updates**: Refresh embeddings after document changes
- **Document Pinning**: Prioritize important documents for queries

### Chat Integration

AnythingLLM chat powers multiple features:
- **Template Enhancement**: AI modifies generators with workspace data
- **Metadata Extraction**: Analyze uploaded documents for structure and content
- **Workspace Indexing**: Generate searchable indexes of customer documents
- **Query Mode**: One-off questions without polluting chat history

### API Proxy

All AnythingLLM requests route through `/api/anythingllm/*` proxy:
- Centralized API key management
- CORS handling
- Error handling and logging
- Frontend accessibility

### Auto-Discovery

DocSmith automatically discovers AnythingLLM instances:
- Scans common ports (3001, 3002, 50000-70000)
- Validates API connectivity with health check
- Updates configuration automatically
- Background monitoring for port changes (Desktop app restarts)

---

## Auto-Updates

### Update System

DocSmith uses electron-updater for seamless application updates:

- **Automatic Check**: Checks for updates 3 seconds after launch
- **User Control**: User must approve download and installation
- **Delta Updates**: Downloads only changed files via blockmap
- **Background Download**: Non-blocking download with progress
- **Install on Quit**: Updates apply when user closes application

### Update UI

The sidebar displays update notifications:

**States**:
- Idle: Shows current version with "Check for Updates" button
- Checking: Animated spinner during check
- Available: "Update available" with download button
- Downloading: Progress bar showing download percentage
- Ready: "Install & Restart" button to apply update

### GitHub Releases

Updates are distributed via GitHub Releases:

**Windows**:
- `DocSmith Setup {version}.exe`
- `DocSmith Setup {version}.exe.blockmap`
- `latest.yml`

**macOS**:
- `DocSmith-{version}.dmg` (Intel)
- `DocSmith-{version}-arm64.dmg` (Apple Silicon)
- `DocSmith-{version}.dmg.blockmap`
- `latest-mac.yml`

### Safe Updates

- Database migrations run automatically after update
- All user data preserved during update process
- Settings and configuration maintained
- Customer files untouched
- Rollback supported via GitHub release deletion

---

## Security

DocSmith implements multiple security layers:

### SQL Injection Prevention
All database queries use parameterized statements. No string concatenation or interpolation with user input:

```typescript
// SAFE: Parameterized query
db.get("SELECT * FROM customers WHERE id = ?", [userId]);

// NEVER: String interpolation
db.get(`SELECT * FROM customers WHERE id = ${userId}`);
```

### Path Traversal Protection
File system operations sanitize all user-supplied names:

```typescript
import { safeFileName } from '../services/fs';

// Blocks: "..", "/", "\\", null bytes
const safeName = safeFileName(userInput);
const customerDir = path.join(libraryRoot(), 'customers', safeName);
```

### Electron IPC Security
Only whitelisted IPC channels exposed via contextBridge:

```typescript
// Preload script
contextBridge.exposeInMainWorld('electronAPI', {
  openPath: (filePath: string) => ipcRenderer.invoke('open-path', filePath)
  // No arbitrary file system access
});
```

### Input Validation
- File uploads validated for type and size
- API parameters sanitized and type-checked
- Template execution sandboxed in isolated VM
- No eval() or Function() constructor usage

### Data Isolation
- Customer data in separate folders
- Workspace-specific template caching
- No cross-customer file access
- Sanitized folder names prevent traversal

### Secrets Management
- API keys never logged or exposed to frontend
- Settings stored in protected `data/.config/` directory
- No secrets in version control
- Environment variable support for sensitive values

### Dependency Security
- Regular `npm audit` checks
- Known vulnerabilities patched promptly
- Minimal dependency footprint
- Peer dependencies reviewed

For detailed security audit, see [SECURITY.md](./SECURITY.md).

---

## Building & Deployment

### Development Build

```bash
# Build backend (esbuild)
npm run build:backend

# Build frontend (Vite)
npm --workspace frontend run build

# Build Electron scripts (TypeScript)
npm run build:electron

# Build all
npm run build
```

### Production Installers

**Windows**:
```bash
npm run build
npm run electron:build:win
```

Output: `dist-release/DocSmith Setup {version}.exe`

**macOS**:
```bash
npm run build
npm run electron:build:mac
```

Output: `dist-release/DocSmith-{version}.dmg`

**Linux**:
```bash
npm run build
npm run electron:build:linux
```

Output: `dist-release/DocSmith-{version}.AppImage`

### Release Process

1. **Update Version**: Increment version in `package.json`
2. **Add Migrations**: If schema changed, add migration to `migrations.ts`
3. **Commit & Tag**: 
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```
4. **Build**: Run platform-specific build command
5. **GitHub Release**: Upload installers and metadata files
6. **Publish**: Users receive update notification automatically

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed release procedures.

---

## Contributing

### Development Setup

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/DocSmith.git`
3. Install dependencies: `npm install`
4. Create feature branch: `git checkout -b feature/your-feature`
5. Make changes and test thoroughly
6. Commit with clear messages
7. Push and create Pull Request

### Code Standards

- **TypeScript**: Strict mode enabled, full type coverage
- **Linting**: ESLint with recommended rules
- **Formatting**: Consistent indentation and style
- **Comments**: Professional, concise documentation
- **Security**: Input validation, parameterized queries, sanitized paths

### Testing

- Test all API endpoints with `backend/tests.http`
- Verify database migrations on clean database
- Check Electron IPC with dev tools
- Test document generation with various templates
- Validate cross-platform compatibility

### Pull Request Guidelines

- Clear description of changes
- Reference related issues
- Include tests for new features
- Update documentation as needed
- Ensure all checks pass

---

## License

MIT License

Copyright (c) 2025 Perry Chapman

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## Support

For issues, feature requests, or questions:
- **GitHub Issues**: https://github.com/perrychapman/DocSmith/issues
- **Documentation**: See in-app Help page
- **Security**: See [SECURITY.md](./SECURITY.md) for reporting vulnerabilities
